const crypto = require('crypto');
const WorkflowDefinition = require('../../models/WorkflowDefinition');
const WorkflowVersion = require('../../models/WorkflowVersion');
const Request = require('../../models/Request');
const WorkflowExecution = require('../../models/WorkflowExecution');
const ExecutionEvent = require('../../models/ExecutionEvent');
const AuditLog = require('../../models/AuditLog');
const ApiError = require('../../utils/ApiError');
const auditService = require('../auditService');
const workflowEngine = require('../workflowEngine');
const idempotencyService = require('../idempotencyService');
const reviewService = require('../reviewService');
const { validateInput } = require('../workflowEngine/validateInput');

function hashPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function getPublishedVersionOrThrow(workflowId) {
  const workflow = await WorkflowDefinition.findById(workflowId);
  if (!workflow) throw ApiError.notFound('Workflow not found');
  if (!workflow.currentPublishedVersion) {
    throw ApiError.conflict('This workflow has no published version to execute');
  }
  const version = await WorkflowVersion.findOne({
    workflowId: workflow._id,
    version: workflow.currentPublishedVersion,
    status: 'published',
  });
  if (!version) {
    throw ApiError.conflict('The published version for this workflow could not be found');
  }
  return { workflow, version };
}

/**
 * Submits a request to a workflow's currently published version and runs it
 * through the execution engine until it pauses or reaches a terminal state.
 *
 * Idempotency (when `idempotencyKey` is provided): guarantees at most one
 * Request/WorkflowExecution is ever created per (workflowId, idempotencyKey),
 * even under concurrent submission or a backend restart mid-request — see
 * services/idempotencyService. Submitting with no key preserves the exact
 * Phase 4 behavior (processed fresh every time, no dedup guarantee).
 */
async function submitRequest({ workflowId, payload, idempotencyKey = null, userId = null }) {
  if (!idempotencyKey) {
    return runSubmission({ workflowId, payload, idempotencyKey: null, userId });
  }

  const payloadHash = hashPayload(payload);
  const claimResult = await idempotencyService.claim(workflowId, idempotencyKey, payloadHash);

  if (claimResult.outcome === 'conflict') {
    await auditService.record({
      workflowId,
      eventType: 'IDEMPOTENCY_CONFLICT',
      actor: userId ? String(userId) : 'system',
      decisionReason: `Idempotency key '${idempotencyKey}' reused with a different payload`,
    });
    throw idempotencyService.conflictError();
  }

  if (claimResult.outcome === 'inProgress') {
    await auditService.record({
      workflowId,
      eventType: 'IDEMPOTENCY_IN_PROGRESS',
      actor: userId ? String(userId) : 'system',
      decisionReason: `Idempotency key '${idempotencyKey}' is already being processed by another request`,
    });
    return { inProgress: true, idempotencyKey, valid: null, execution: null, request: null };
  }

  if (claimResult.outcome === 'replay') {
    await auditService.record({
      workflowId,
      requestId: claimResult.record.requestId,
      executionId: claimResult.record.executionId,
      eventType: 'IDEMPOTENCY_REPLAY',
      actor: userId ? String(userId) : 'system',
      decisionReason: `Idempotency key '${idempotencyKey}' replayed its stored result`,
    });
    return replayResult(claimResult.record);
  }

  // outcome === 'claimed' (fresh claim, or a reclaimed stale/failed lease)
  try {
    const result = await runSubmission({ workflowId, payload, idempotencyKey, userId });
    await idempotencyService.complete(claimResult.record, result);
    return result;
  } catch (err) {
    await idempotencyService.fail(claimResult.record, err);
    throw err;
  }
}

async function replayResult(record) {
  const [request, execution] = await Promise.all([
    record.requestId ? Request.findById(record.requestId).lean() : null,
    record.executionId ? WorkflowExecution.findById(record.executionId).lean() : null,
  ]);
  return {
    request: request || record.resultSnapshot?.request || null,
    execution: execution || record.resultSnapshot?.execution || null,
    valid: record.resultSnapshot?.valid ?? true,
    errors: record.resultSnapshot?.errors || [],
    replayed: true,
  };
}

async function runSubmission({ workflowId, payload, idempotencyKey, userId }) {
  const { workflow, version } = await getPublishedVersionOrThrow(workflowId);

  const payloadHash = hashPayload(payload);
  const validationErrors = validateInput(version.inputSchema, payload);

  if (validationErrors.length > 0) {
    const request = await Request.create({
      workflowId: workflow._id,
      payload,
      payloadHash,
      idempotencyKey,
      status: 'rejected_invalid',
      validationErrors,
      submittedBy: userId,
    });

    await auditService.record({
      requestId: request._id,
      workflowId: workflow._id,
      workflowVersionNumber: version.version,
      eventType: 'VALIDATION_RESULT',
      actor: userId ? String(userId) : 'system',
      decisionReason: 'Request rejected: input schema validation failed',
      dataRef: `request:${request._id}`,
      errorInfo: validationErrors,
    });

    return { request, execution: null, valid: false, errors: validationErrors };
  }

  const request = await Request.create({
    workflowId: workflow._id,
    payload,
    payloadHash,
    idempotencyKey,
    status: 'accepted',
    submittedBy: userId,
  });

  await auditService.record({
    requestId: request._id,
    workflowId: workflow._id,
    workflowVersionNumber: version.version,
    eventType: 'REQUEST_SUBMITTED',
    actor: userId ? String(userId) : 'system',
    decisionReason: 'Request accepted and passed input validation',
    dataRef: `request:${request._id}`,
  });

  const execution = await workflowEngine.start(request, version, userId);
  const finalExecution = await workflowEngine.advance(execution, version, payload);

  await reviewService.ensureReviewForPausedExecution(finalExecution, version);

  return { request, execution: finalExecution, valid: true, errors: [] };
}

async function listRequests({ page = 1, limit = 20, workflowId, status } = {}) {
  const filter = {};
  if (workflowId) filter.workflowId = workflowId;
  if (status) filter.status = status;

  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    Request.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Request.countDocuments(filter),
  ]);

  return { items, total, page: Number(page), limit: Number(limit) };
}

async function getRequestOr404(requestId) {
  const request = await Request.findById(requestId).lean();
  if (!request) throw ApiError.notFound('Request not found');
  return request;
}

async function listExecutions({ page = 1, limit = 20, workflowId, currentState } = {}) {
  const filter = {};
  if (workflowId) filter.workflowId = workflowId;
  if (currentState) filter.currentState = currentState;

  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    WorkflowExecution.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    WorkflowExecution.countDocuments(filter),
  ]);

  return { items, total, page: Number(page), limit: Number(limit) };
}

async function getExecutionOr404(executionId) {
  const execution = await WorkflowExecution.findById(executionId).lean();
  if (!execution) throw ApiError.notFound('Execution not found');
  return execution;
}

async function getExecutionHistory(executionId) {
  await getExecutionOr404(executionId);
  const [events, audits] = await Promise.all([
    ExecutionEvent.find({ executionId }).sort({ createdAt: 1 }).lean(),
    AuditLog.find({ executionId }).sort({ createdAt: 1 }).lean(),
  ]);
  return { events, auditTrail: audits };
}

/**
 * Builds a full decision explanation for an execution: which workflow version
 * ran, every rule evaluated (with pass/fail/reason), every stage transition,
 * and the final decision. Reads only from the execution's pinned WorkflowVersion
 * (immutable once published) and its own AuditLog entries, so historical
 * explanations never depend on the workflow's current (possibly newer) config.
 */
async function getExecutionExplanation(executionId) {
  const execution = await getExecutionOr404(executionId);
  const version = await WorkflowVersion.findById(execution.workflowVersionId).lean();
  const audits = await AuditLog.find({ executionId }).sort({ createdAt: 1 }).lean();

  const ruleEvaluations = audits.filter((a) => a.eventType === 'RULE_EVALUATION');
  const transitions = audits.filter((a) => a.eventType === 'STAGE_TRANSITION');
  const failures = audits.filter((a) => a.eventType === 'FAILURE');

  return {
    executionId: execution._id,
    requestId: execution.requestId,
    workflowId: execution.workflowId,
    workflowVersionId: execution.workflowVersionId,
    workflowVersionNumber: execution.workflowVersionNumber,
    finalState: execution.currentState,
    finalDecision: execution.finalDecision,
    finalReason: execution.finalReason,
    startStageId: version?.startStageId || null,
    ruleEvaluations: ruleEvaluations.map((a) => ({
      stageReason: a.decisionReason,
      ruleTrace: a.ruleTrace,
      at: a.createdAt,
    })),
    transitions: transitions.map((a) => ({ reason: a.decisionReason, at: a.createdAt })),
    failures: failures.map((a) => ({ reason: a.decisionReason, errorInfo: a.errorInfo, at: a.createdAt })),
  };
}

module.exports = {
  submitRequest,
  listRequests,
  getRequestOr404,
  listExecutions,
  getExecutionOr404,
  getExecutionHistory,
  getExecutionExplanation,
  getPublishedVersionOrThrow,
};
