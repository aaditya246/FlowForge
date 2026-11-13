/**
 * Retry service — decides retry eligibility, computes backoff delay, and
 * creates/claims RetryRecord checkpoints. The actual durable resumption of due
 * retries (polling + re-invoking the workflow engine) lives in
 * services/recoveryService, which uses findDueRetries/claimRetry from here.
 *
 * Durability note: all retry scheduling state lives in MongoDB (RetryRecord +
 * WorkflowExecution), never in-memory (no setTimeout holding "the next attempt").
 * `jobs/retryScheduler.js` polls recoveryService.runRecoverySweep() on an interval
 * from server.js; a backend restart loses nothing because the next poll simply
 * finds the same due records again. See PHASE_5_REPORT.md for why this was
 * chosen over BullMQ/Redis.
 */
const RetryRecord = require('../../models/RetryRecord');
const ExecutionEvent = require('../../models/ExecutionEvent');
const auditService = require('../auditService');
const { assertValidTransition } = require('../stateManagement');

const DEFAULT_RETRY_CONFIG = { maxAttempts: 0, delayMs: 1000, backoff: 'fixed', backoffMultiplier: 2, maxDelayMs: 30000, jitter: false };

/**
 * @param {number} attemptNumber - 1-based attempt that just failed
 * @param {Object} retryConfig - a stage's `retry` sub-document
 */
function computeDelayMs(attemptNumber, retryConfig = {}) {
  const cfg = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
  let delay = cfg.backoff === 'exponential' ? cfg.delayMs * Math.pow(cfg.backoffMultiplier, attemptNumber - 1) : cfg.delayMs;
  delay = Math.min(delay, cfg.maxDelayMs);
  if (cfg.jitter) {
    delay = delay * (0.5 + Math.random() * 0.5); // 50%-100% of computed delay
  }
  return Math.max(0, Math.round(delay));
}

/**
 * Schedules a retry for the given execution/stage: creates a RetryRecord,
 * increments execution.retryCount, and transitions to RETRY_PENDING. Returns
 * null (and leaves the execution untouched) if the configured attempt limit has
 * already been reached — the caller is responsible for finalizing as exhausted.
 */
async function scheduleRetry(execution, stage, { reason, originalError = null }) {
  const retryConfig = stage.retry || DEFAULT_RETRY_CONFIG;
  const maxAttempts = retryConfig.maxAttempts || 0;
  const nextAttempt = execution.retryCount + 1;

  if (maxAttempts === 0 || nextAttempt > maxAttempts) {
    return null; // exhausted (or retries not configured at all for this stage)
  }

  const delayMs = computeDelayMs(nextAttempt, retryConfig);
  const scheduledAt = new Date(Date.now() + delayMs);

  const retryRecord = await RetryRecord.create({
    executionId: execution._id,
    attemptNumber: nextAttempt,
    originalError,
    retryReason: reason,
    scheduledAt,
    result: 'pending',
  });

  execution.retryCount = nextAttempt;
  const fromState = execution.currentState;
  assertValidTransition(fromState, 'RETRY_PENDING');
  execution.currentState = 'RETRY_PENDING';
  await execution.save();

  await ExecutionEvent.create({
    executionId: execution._id,
    fromState,
    toState: 'RETRY_PENDING',
    stageId: execution.currentStageId,
    actor: 'system',
    reason: `${reason} — retry ${nextAttempt}/${maxAttempts} scheduled for ${scheduledAt.toISOString()}`,
  });

  await auditService.record({
    executionId: execution._id,
    requestId: execution.requestId,
    workflowId: execution.workflowId,
    workflowVersionNumber: execution.workflowVersionNumber,
    eventType: 'RETRY_SCHEDULED',
    actor: 'system',
    decisionReason: `Attempt ${nextAttempt}/${maxAttempts}, delay ${delayMs}ms (${retryConfig.backoff}): ${reason}`,
    errorInfo: originalError ? { message: originalError } : null,
  });

  return retryRecord;
}

/**
 * Finds RetryRecords whose scheduled time has arrived and are still 'pending'.
 */
async function findDueRetries(now = new Date()) {
  return RetryRecord.find({ result: 'pending', scheduledAt: { $lte: now } }).sort({ scheduledAt: 1 }).lean();
}

/**
 * Atomically claims a due, unclaimed RetryRecord so only one worker/poll tick
 * processes it — the condition `executedAt: null` is the claim gate; whichever
 * concurrent caller's findOneAndUpdate matches first wins, all others get null
 * back. The actual outcome ('succeeded'/'failed'/'exhausted') is set afterward
 * by the caller once the retry attempt has actually run.
 */
async function claimRetry(retryRecordId) {
  return RetryRecord.findOneAndUpdate(
    { _id: retryRecordId, result: 'pending', executedAt: null },
    { $set: { executedAt: new Date() } },
    { new: true }
  );
}

async function markSucceeded(retryRecordId) {
  return RetryRecord.findByIdAndUpdate(retryRecordId, { $set: { result: 'succeeded' } });
}

async function markFailed(retryRecordId) {
  return RetryRecord.findByIdAndUpdate(retryRecordId, { $set: { result: 'failed' } });
}

async function markExhausted(retryRecordId) {
  return RetryRecord.findByIdAndUpdate(retryRecordId, { $set: { result: 'exhausted' } });
}

module.exports = {
  DEFAULT_RETRY_CONFIG,
  computeDelayMs,
  scheduleRetry,
  findDueRetries,
  claimRetry,
  markSucceeded,
  markFailed,
  markExhausted,
};
