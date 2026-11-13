/**
 * Review service — the human-in-the-loop lifecycle around a MANUAL_REVIEW pause:
 * creation, queueing, assignment, reviewer decisions, additional-information
 * requests, escalation, and safely resuming the workflow engine.
 *
 * Concurrency: every status-changing action claims the review with an atomic
 * conditional findOneAndUpdate (only matching the expected current status/
 * assignee), the same pattern used in services/idempotencyService and
 * services/recoveryService — never a bare read-then-write. ManualReview also
 * has Mongoose optimisticConcurrency enabled as a second line of defense.
 */
const mongoose = require('mongoose');
const ManualReview = require('../../models/ManualReview');
const ReviewAction = require('../../models/ReviewAction');
const WorkflowExecution = require('../../models/WorkflowExecution');
const WorkflowVersion = require('../../models/WorkflowVersion');
const Request = require('../../models/Request');
const User = require('../../models/User');
const AuditLog = require('../../models/AuditLog');
const ApiError = require('../../utils/ApiError');
const auditService = require('../auditService');
const notificationService = require('../notificationService');

const DEFAULT_SLA_MS = 24 * 60 * 60 * 1000; // 24h
const NON_TERMINAL_STATUSES = ['PENDING', 'ASSIGNED', 'IN_REVIEW', 'MORE_INFORMATION_REQUIRED', 'ESCALATED'];

function findStage(workflowVersion, stageId) {
  return (workflowVersion.stages || []).find((s) => s.stageId === stageId) || null;
}

async function recordAction(review, { actionType, actor, previousStatus, newStatus, comment = '', metadata = null }) {
  await ReviewAction.create({
    reviewId: review._id,
    executionId: review.executionId,
    actionType,
    actorId: actor?._id || null,
    actorRole: actor?.role || null,
    previousStatus,
    newStatus,
    comment,
    metadata,
  });
}

async function auditReview(review, eventType, actor, decisionReason, extra = {}) {
  await auditService.record({
    executionId: review.executionId,
    requestId: review.requestId,
    workflowId: review.workflowId,
    workflowVersionNumber: extra.workflowVersionNumber,
    eventType,
    actor: actor ? String(actor._id) : 'system',
    decisionReason,
    ...extra,
  });
}

/**
 * Creates a ManualReview for an execution that just paused at MANUAL_REVIEW, if
 * one doesn't already exist (idempotent — safe to call after every advance()).
 */
async function ensureReviewForPausedExecution(execution, workflowVersion, { reason } = {}) {
  if (execution.currentState !== 'MANUAL_REVIEW') return null;

  const existing = await ManualReview.findOne({ executionId: execution._id, status: { $in: NON_TERMINAL_STATUSES } });
  if (existing) return existing;

  if (!reason) {
    // Derive a human-readable reason straight from the audit trail — the most
    // recent rule evaluation or routing decision recorded for this execution —
    // rather than requiring every caller to compute it.
    const relevantAudit = await AuditLog.findOne({
      executionId: execution._id,
      eventType: { $in: ['MANUAL_REVIEW_ROUTED', 'RULE_EVALUATION'] },
    })
      .sort({ createdAt: -1 })
      .lean();
    reason = relevantAudit?.decisionReason || `Execution paused for manual review at stage '${execution.currentStageId}'`;
  }

  const stage = findStage(workflowVersion, execution.currentStageId) || {};
  const slaMs = stage.reviewSlaMs || DEFAULT_SLA_MS;
  const escalationThresholdMs = stage.reviewEscalationThresholdMs || slaMs;
  const priority = stage.reviewPriority || 'normal';

  const review = await ManualReview.create({
    requestId: execution.requestId,
    executionId: execution._id,
    workflowId: execution.workflowId,
    workflowVersionId: execution.workflowVersionId,
    stageId: execution.currentStageId,
    status: 'PENDING',
    reason,
    priority,
    slaMs,
    escalationThresholdMs,
    dueAt: new Date(Date.now() + slaMs),
  });

  await recordAction(review, { actionType: 'CREATED', actor: null, previousStatus: null, newStatus: 'PENDING' });
  await auditReview(review, 'REVIEW_CREATED', null, `Manual review created for execution ${execution._id} at stage '${execution.currentStageId}'`);

  return review;
}

async function getReviewOr404(reviewId) {
  const review = await ManualReview.findById(reviewId);
  if (!review) throw ApiError.notFound('Review not found');
  return review;
}

function assertCanAccessReview(review, user) {
  if (user.role === 'admin' || user.role === 'viewer') return; // viewer is read-only, enforced at route level for writes
  if (user.role === 'reviewer') {
    if (review.assignedReviewerId && String(review.assignedReviewerId) !== String(user._id)) {
      throw ApiError.forbidden('This review is assigned to a different reviewer');
    }
    return;
  }
}

/**
 * Database-filtered, paginated, sorted review listing. Never loads the full
 * collection into memory — every filter maps to an indexed query field.
 */
async function listReviews({
  page = 1,
  limit = 20,
  status,
  assignedReviewerId,
  unassigned,
  workflowId,
  priority,
  escalatedOnly,
  overdueOnly,
  search,
  sortBy = 'createdAt',
  sortDir = 'desc',
  requestingUser,
} = {}) {
  const filter = {};
  if (status) filter.status = status;
  if (workflowId) filter.workflowId = workflowId;
  if (priority) filter.priority = priority;
  if (escalatedOnly) filter.status = 'ESCALATED';
  if (overdueOnly) {
    filter.dueAt = { $lte: new Date() };
    filter.status = { $in: NON_TERMINAL_STATUSES };
  }
  if (unassigned) {
    filter.assignedReviewerId = null;
  } else if (assignedReviewerId) {
    filter.assignedReviewerId = assignedReviewerId;
  }

  // Reviewers only ever see their own assigned reviews or unassigned ones —
  // enforced here (not just hidden in the UI) regardless of what filters were requested.
  if (requestingUser?.role === 'reviewer') {
    filter.$or = [{ assignedReviewerId: requestingUser._id }, { assignedReviewerId: null }];
  }

  if (search) {
    const asObjectId = mongoose.Types.ObjectId.isValid(search) ? new mongoose.Types.ObjectId(search) : null;
    const orClauses = [{ stageId: { $regex: search, $options: 'i' } }];
    if (asObjectId) {
      orClauses.push({ _id: asObjectId }, { requestId: asObjectId }, { executionId: asObjectId });
    }
    filter.$and = [...(filter.$and || []), { $or: orClauses }];
  }

  const skip = (page - 1) * limit;
  const sort = { [sortBy]: sortDir === 'asc' ? 1 : -1 };

  const [items, total] = await Promise.all([
    ManualReview.find(filter).sort(sort).skip(skip).limit(Number(limit)).lean(),
    ManualReview.countDocuments(filter),
  ]);

  return { items, total, page: Number(page), limit: Number(limit) };
}

async function getReviewStats() {
  const now = new Date();
  const [byStatus, overdue] = await Promise.all([
    ManualReview.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    ManualReview.countDocuments({ status: { $in: NON_TERMINAL_STATUSES }, dueAt: { $lte: now } }),
  ]);

  const counts = byStatus.reduce((acc, s) => ({ ...acc, [s._id]: s.count }), {});
  return {
    pending: counts.PENDING || 0,
    assigned: counts.ASSIGNED || 0,
    inReview: counts.IN_REVIEW || 0,
    moreInformationRequired: counts.MORE_INFORMATION_REQUIRED || 0,
    escalated: counts.ESCALATED || 0,
    approved: counts.APPROVED || 0,
    rejected: counts.REJECTED || 0,
    cancelled: counts.CANCELLED || 0,
    unassigned: await ManualReview.countDocuments({ assignedReviewerId: null, status: { $in: NON_TERMINAL_STATUSES } }),
    overdue,
  };
}

async function listReviewers() {
  return User.find({ role: 'reviewer', isActive: true }).select('name email').lean();
}

async function getReviewerWorkload() {
  const workload = await ManualReview.aggregate([
    { $match: { assignedReviewerId: { $ne: null }, status: { $in: ['ASSIGNED', 'IN_REVIEW', 'MORE_INFORMATION_REQUIRED', 'ESCALATED'] } } },
    { $group: { _id: '$assignedReviewerId', activeReviews: { $sum: 1 } } },
  ]);
  const reviewerIds = workload.map((w) => w._id);
  const reviewers = await User.find({ _id: { $in: reviewerIds } }).select('name email').lean();
  const byId = reviewers.reduce((acc, r) => ({ ...acc, [String(r._id)]: r }), {});
  return workload.map((w) => ({ reviewer: byId[String(w._id)] || { _id: w._id }, activeReviews: w.activeReviews }));
}

/**
 * Assigns (or reassigns) a review to a reviewer. Admin-only (enforced at route
 * level). Rejects inactive users and non-reviewer roles.
 */
async function assignReview(reviewId, reviewerId, actor) {
  const reviewer = await User.findById(reviewerId);
  if (!reviewer || !reviewer.isActive || reviewer.role !== 'reviewer') {
    throw ApiError.badRequest('Target user is not an active reviewer');
  }

  const existing = await getReviewOr404(reviewId);
  if (!NON_TERMINAL_STATUSES.includes(existing.status)) {
    throw ApiError.conflict(`Review is already ${existing.status} and cannot be reassigned`);
  }

  const previousStatus = existing.status;
  const wasAssigned = Boolean(existing.assignedReviewerId);
  const previousReviewerId = existing.assignedReviewerId;

  // Assignment isn't an exclusive claim like a decision — two concurrent
  // assign calls are both individually valid (whoever the admin meant last
  // should win). A single atomic update avoids the optimisticConcurrency
  // VersionError that a load-then-.save() would throw under a genuine race.
  const review = await ManualReview.findOneAndUpdate(
    { _id: reviewId, status: { $in: NON_TERMINAL_STATUSES } },
    {
      $set: {
        assignedReviewerId: reviewer._id,
        assignedAt: new Date(),
        ...(previousStatus === 'PENDING' ? { status: 'ASSIGNED' } : {}),
      },
    },
    { new: true }
  );
  if (!review) {
    throw ApiError.conflict('Review is no longer in an assignable state');
  }

  await recordAction(review, {
    actionType: wasAssigned ? 'REASSIGNED' : 'ASSIGNED',
    actor,
    previousStatus,
    newStatus: review.status,
    metadata: { reviewerId: reviewer._id, previousReviewerId },
  });
  await auditReview(review, wasAssigned ? 'REVIEW_REASSIGNED' : 'REVIEW_ASSIGNED', actor, `Review assigned to ${reviewer.name}`);

  await notificationService.createNotification({
    userId: reviewer._id,
    type: wasAssigned ? 'REVIEW_REASSIGNED' : 'REVIEW_ASSIGNED',
    title: wasAssigned ? 'Review reassigned to you' : 'New review assigned',
    message: `A manual review (stage '${review.stageId}') has been assigned to you.`,
    link: `/reviews/${review._id}`,
    data: { reviewId: review._id, executionId: review.executionId },
  });

  return review;
}

async function unassignReview(reviewId, actor) {
  const existing = await getReviewOr404(reviewId);
  if (!NON_TERMINAL_STATUSES.includes(existing.status)) {
    throw ApiError.conflict(`Review is already ${existing.status} and cannot be modified`);
  }

  const previousStatus = existing.status;
  const review = await ManualReview.findOneAndUpdate(
    { _id: reviewId, status: { $in: NON_TERMINAL_STATUSES } },
    { $set: { assignedReviewerId: null, assignedAt: null, status: 'PENDING' } },
    { new: true }
  );
  if (!review) {
    throw ApiError.conflict('Review is no longer in a modifiable state');
  }

  await recordAction(review, { actionType: 'UNASSIGNED', actor, previousStatus, newStatus: review.status });
  await auditReview(review, 'REVIEW_UNASSIGNED', actor, 'Review unassigned');

  return review;
}

/**
 * Atomically claims a review for a status-changing action: only succeeds if the
 * review is currently in one of `fromStatuses` — this is what prevents two
 * concurrent decisions (or a double-click) from both succeeding.
 */
async function claimReview(reviewId, fromStatuses, toStatus) {
  const claimed = await ManualReview.findOneAndUpdate(
    { _id: reviewId, status: { $in: fromStatuses } },
    { $set: { status: toStatus } },
    { new: true }
  );
  if (!claimed) {
    const current = await ManualReview.findById(reviewId);
    if (!current) throw ApiError.notFound('Review not found');
    throw ApiError.conflict(`Review is currently '${current.status}' — this action is no longer valid`);
  }
  return claimed;
}

async function startReview(reviewId, actor) {
  const review = await getReviewOr404(reviewId);
  assertCanAccessReview(review, actor);
  if (actor.role === 'reviewer' && String(review.assignedReviewerId) !== String(actor._id)) {
    throw ApiError.forbidden('Only the assigned reviewer can start this review');
  }

  const previousStatus = review.status;
  const claimed = await claimReview(reviewId, ['ASSIGNED', 'MORE_INFORMATION_REQUIRED', 'ESCALATED'], 'IN_REVIEW');
  claimed.startedAt = claimed.startedAt || new Date();
  await claimed.save();

  await recordAction(claimed, { actionType: 'STARTED', actor, previousStatus, newStatus: 'IN_REVIEW' });
  await auditReview(claimed, 'REVIEW_STARTED', actor, 'Reviewer started the review');

  return claimed;
}

/**
 * Applies a reviewer's APPROVE/REJECT decision: claims the review (preventing a
 * duplicate decision), verifies the execution is actually still paused for
 * manual review, resumes the workflow engine via the paused stage's own
 * configured transition, and records everything.
 */
async function decide(reviewId, actor, { decision, comment }) {
  if (!comment || !comment.trim()) {
    throw ApiError.badRequest(`A ${decision === 'APPROVE' ? 'decision' : 'rejection'} comment is required`);
  }

  const review = await getReviewOr404(reviewId);
  assertCanAccessReview(review, actor);
  if (actor.role === 'reviewer' && review.assignedReviewerId && String(review.assignedReviewerId) !== String(actor._id)) {
    throw ApiError.forbidden('This review is assigned to a different reviewer');
  }

  const previousStatus = review.status;
  const targetStatus = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  // The atomic claim is the single point that prevents two simultaneous decisions
  // from both succeeding — exactly one findOneAndUpdate can match a non-terminal status.
  const claimed = await claimReview(reviewId, NON_TERMINAL_STATUSES, targetStatus);

  const execution = await WorkflowExecution.findById(claimed.executionId);
  if (!execution) {
    throw ApiError.conflict('The associated workflow execution no longer exists');
  }
  if (execution.currentState !== 'MANUAL_REVIEW') {
    // Defensive: the claim above already prevents double-decisions at the review
    // level, but if the execution itself is somehow no longer paused, refuse to
    // touch it rather than risk a corrupt resume.
    throw ApiError.conflict(`Execution is in state '${execution.currentState}', not MANUAL_REVIEW — cannot resume`);
  }

  const version = await WorkflowVersion.findById(execution.workflowVersionId);
  const request = await Request.findById(execution.requestId);

  claimed.decision = decision;
  claimed.decisionReason = comment;
  claimed.completedAt = new Date();
  await claimed.save();

  await recordAction(claimed, {
    actionType: targetStatus === 'APPROVED' ? 'APPROVED' : 'REJECTED',
    actor,
    previousStatus,
    newStatus: targetStatus,
    comment,
  });
  await auditReview(claimed, 'REVIEW_COMPLETED', actor, `Reviewer ${decision === 'APPROVE' ? 'approved' : 'rejected'}: ${comment}`, {
    workflowVersionNumber: execution.workflowVersionNumber,
  });

  const workflowEngine = require('../workflowEngine');
  const finalExecution = await workflowEngine.advance(execution, version, request.payload, decision);

  if (request?.submittedBy) {
    await notificationService.createNotification({
      userId: request.submittedBy,
      type: decision === 'APPROVE' ? 'REVIEW_APPROVED' : 'REVIEW_REJECTED',
      title: `Your request was ${decision === 'APPROVE' ? 'approved' : 'rejected'}`,
      message: comment,
      link: `/executions/${execution._id}`,
      data: { reviewId: claimed._id, executionId: execution._id },
    });
  }

  return { review: claimed, execution: finalExecution };
}

async function approveReview(reviewId, actor, { comment }) {
  return decide(reviewId, actor, { decision: 'APPROVE', comment });
}

async function rejectReview(reviewId, actor, { comment }) {
  return decide(reviewId, actor, { decision: 'REJECT', comment });
}

async function requestMoreInformation(reviewId, actor, { explanation }) {
  if (!explanation || !explanation.trim()) {
    throw ApiError.badRequest('An explanation of what information is needed is required');
  }

  const review = await getReviewOr404(reviewId);
  assertCanAccessReview(review, actor);
  if (actor.role === 'reviewer' && review.assignedReviewerId && String(review.assignedReviewerId) !== String(actor._id)) {
    throw ApiError.forbidden('This review is assigned to a different reviewer');
  }

  const previousStatus = review.status;
  const claimed = await claimReview(reviewId, ['ASSIGNED', 'IN_REVIEW'], 'MORE_INFORMATION_REQUIRED');
  claimed.informationRequest = explanation;
  claimed.informationRequestedAt = new Date();
  await claimed.save();

  await recordAction(claimed, { actionType: 'MORE_INFORMATION_REQUESTED', actor, previousStatus, newStatus: 'MORE_INFORMATION_REQUIRED', comment: explanation });
  await auditReview(claimed, 'REVIEW_INFORMATION_REQUESTED', actor, explanation);

  const request = await Request.findById(claimed.requestId).lean();
  if (request?.submittedBy) {
    await notificationService.createNotification({
      userId: request.submittedBy,
      type: 'INFORMATION_REQUESTED',
      title: 'Additional information requested',
      message: explanation,
      link: `/reviews/${claimed._id}`,
      data: { reviewId: claimed._id },
    });
  }

  return claimed;
}

async function submitInformation(reviewId, actor, { text }) {
  if (!text || !text.trim()) {
    throw ApiError.badRequest('Information text is required');
  }

  const review = await getReviewOr404(reviewId);
  if (review.status !== 'MORE_INFORMATION_REQUIRED') {
    throw ApiError.conflict('This review is not currently waiting for additional information');
  }

  review.submittedInformation.push({ text, submittedBy: actor._id, submittedAt: new Date() });
  const previousStatus = review.status;
  review.status = review.assignedReviewerId ? 'ASSIGNED' : 'PENDING';
  await review.save();

  await recordAction(review, { actionType: 'INFORMATION_SUBMITTED', actor, previousStatus, newStatus: review.status, comment: text });
  await auditReview(review, 'REVIEW_INFORMATION_SUBMITTED', actor, 'Additional information submitted');

  if (review.assignedReviewerId) {
    await notificationService.createNotification({
      userId: review.assignedReviewerId,
      type: 'INFORMATION_SUBMITTED',
      title: 'Additional information submitted',
      message: `New information was submitted for review ${review._id}.`,
      link: `/reviews/${review._id}`,
      data: { reviewId: review._id },
    });
  }

  return review;
}

async function getInformationHistory(reviewId) {
  const review = await getReviewOr404(reviewId);
  return {
    informationRequest: review.informationRequest,
    informationRequestedAt: review.informationRequestedAt,
    submittedInformation: review.submittedInformation,
  };
}

async function escalateReview(reviewId, actor, { reason }) {
  if (!reason || !reason.trim()) {
    throw ApiError.badRequest('An escalation reason is required');
  }

  const review = await getReviewOr404(reviewId);
  assertCanAccessReview(review, actor);

  const previousStatus = review.status;
  if (!NON_TERMINAL_STATUSES.includes(review.status)) {
    throw ApiError.conflict(`Review is already ${review.status} and cannot be escalated`);
  }

  const claimed = await claimReview(reviewId, NON_TERMINAL_STATUSES, 'ESCALATED');
  claimed.escalatedAt = new Date();
  claimed.escalationReason = reason;
  await claimed.save();

  await recordAction(claimed, { actionType: 'ESCALATED', actor, previousStatus, newStatus: 'ESCALATED', comment: reason });
  await auditReview(claimed, 'REVIEW_ESCALATED', actor, reason);

  const admins = await User.find({ role: 'admin', isActive: true }).select('_id').lean();
  await Promise.all(
    admins.map((admin) =>
      notificationService.createNotification({
        userId: admin._id,
        type: 'REVIEW_ESCALATED',
        title: 'Review escalated',
        message: reason,
        link: `/reviews/${claimed._id}`,
        data: { reviewId: claimed._id },
      })
    )
  );

  return claimed;
}

async function findOverdueReviews(now = new Date()) {
  const escalatable = NON_TERMINAL_STATUSES.filter((s) => s !== 'ESCALATED');
  return ManualReview.find({ status: { $in: escalatable }, dueAt: { $lte: now } }).lean();
}

/**
 * Auto-escalates any review past its due date and not already escalated. Safe
 * to run repeatedly/concurrently — each escalation is itself an atomic claim.
 */
async function runEscalationSweep(now = new Date()) {
  const overdue = await ManualReview.find({
    status: { $in: ['PENDING', 'ASSIGNED', 'IN_REVIEW', 'MORE_INFORMATION_REQUIRED'] },
    dueAt: { $lte: now },
  }).lean();

  let escalatedCount = 0;
  for (const review of overdue) {
    const claimed = await ManualReview.findOneAndUpdate(
      { _id: review._id, status: review.status },
      { $set: { status: 'ESCALATED', escalatedAt: now, escalationReason: 'SLA deadline exceeded' } },
      { new: true }
    );
    if (!claimed) continue; // lost the race to another sweep tick — fine, already handled

    escalatedCount += 1;
    await recordAction(claimed, {
      actionType: 'ESCALATED',
      actor: null,
      previousStatus: review.status,
      newStatus: 'ESCALATED',
      comment: 'Automatically escalated: SLA deadline exceeded',
    });
    await auditReview(claimed, 'REVIEW_ESCALATED', null, 'Automatically escalated: SLA deadline exceeded');

    const admins = await User.find({ role: 'admin', isActive: true }).select('_id').lean();
    await Promise.all(
      admins.map((admin) =>
        notificationService.createNotification({
          userId: admin._id,
          type: 'REVIEW_OVERDUE',
          title: 'Review overdue and escalated',
          message: `Review ${claimed._id} exceeded its SLA deadline and was automatically escalated.`,
          link: `/reviews/${claimed._id}`,
          data: { reviewId: claimed._id },
        })
      )
    );
  }

  return { escalatedCount };
}

module.exports = {
  ensureReviewForPausedExecution,
  getReviewOr404,
  listReviews,
  getReviewStats,
  listReviewers,
  getReviewerWorkload,
  assignReview,
  unassignReview,
  startReview,
  approveReview,
  rejectReview,
  requestMoreInformation,
  submitInformation,
  getInformationHistory,
  escalateReview,
  findOverdueReviews,
  runEscalationSweep,
  NON_TERMINAL_STATUSES,
  DEFAULT_SLA_MS,
};
