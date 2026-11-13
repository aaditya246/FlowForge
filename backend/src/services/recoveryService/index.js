/**
 * Recovery service — finds and safely resumes work that was interrupted by a
 * crash, an expired processing lease, or a due retry; reconciles dependency
 * calls left in an inconclusive 'pending' state.
 *
 * Concurrency model: before any resume, this service atomically flips the
 * target execution's currentState with a conditional findOneAndUpdate (a
 * document-level claim gate), so two concurrent recovery sweeps — or a sweep
 * racing a manual "retry now" admin action — can never both resume the same
 * execution. workflowEngine.advance() additionally relies on Mongoose's
 * optimisticConcurrency (see models/WorkflowExecution) as a second line of
 * defense against any save-level race that slips through.
 */
const WorkflowExecution = require('../../models/WorkflowExecution');
const WorkflowVersion = require('../../models/WorkflowVersion');
const Request = require('../../models/Request');
const ExternalDependencyLog = require('../../models/ExternalDependencyLog');
const auditService = require('../auditService');
const retryService = require('../retryService');
const reviewService = require('../reviewService');

// A PROCESSING execution whose document hasn't been touched in this long is
// presumed to have lost its worker (process crash mid-stage) and is eligible
// for recovery.
const STUCK_PROCESSING_MS = 2 * 60 * 1000;
// A dependency call checkpoint left 'pending' this long means the process
// crashed between making the call and recording its outcome — genuinely
// inconclusive, not safely replayable or safely assumable either way.
const STUCK_PENDING_DEPENDENCY_MS = 60 * 1000;

async function findInterruptedExecutions(now = new Date()) {
  const cutoff = new Date(now.getTime() - STUCK_PROCESSING_MS);
  return WorkflowExecution.find({ currentState: 'PROCESSING', updatedAt: { $lte: cutoff } }).lean();
}

async function findPendingDependencyLogs(now = new Date()) {
  const cutoff = new Date(now.getTime() - STUCK_PENDING_DEPENDENCY_MS);
  return ExternalDependencyLog.find({ status: 'pending', updatedAt: { $lte: cutoff } }).lean();
}

/**
 * Resumes a single execution (called for both a due retry and a stuck
 * PROCESSING execution) via workflowEngine.advance(), re-entering at whatever
 * stage/state it was last persisted at. Never repeats an already-completed
 * stage's side effects: the engine only re-runs the CURRENT stage forward from
 * its last durable checkpoint, and external_dependency calls are themselves
 * deduplicated by operationId (see services/externalDependency).
 */
async function resumeExecution(executionId, { actor = 'system', expectedState } = {}) {
  // workflowEngine is required lazily to avoid a require cycle
  // (workflowEngine -> retryService, recoveryService -> workflowEngine).
  const workflowEngine = require('../workflowEngine');

  const filter = { _id: executionId };
  if (expectedState) filter.currentState = expectedState;

  // Document-level claim: only the caller whose conditional update actually
  // matches gets to resume. A concurrent duplicate resume attempt finds
  // nothing to match and backs off cleanly instead of double-processing.
  const claimed = expectedState
    ? await WorkflowExecution.findOneAndUpdate(filter, { $set: { updatedAt: new Date() } }, { new: true })
    : await WorkflowExecution.findById(executionId);

  if (!claimed) {
    return { outcome: 'already-claimed', executionId };
  }

  const request = await Request.findById(claimed.requestId).lean();
  const version = await WorkflowVersion.findById(claimed.workflowVersionId);
  if (!request || !version) {
    await auditService.record({
      executionId: claimed._id,
      eventType: 'RECOVERY_FAILED',
      actor,
      decisionReason: 'Cannot recover: missing Request or WorkflowVersion document',
    });
    return { outcome: 'missing-records', executionId };
  }

  await auditService.record({
    executionId: claimed._id,
    requestId: claimed.requestId,
    workflowId: claimed.workflowId,
    workflowVersionNumber: claimed.workflowVersionNumber,
    eventType: 'RECOVERY_STARTED',
    actor,
    decisionReason: `Resuming execution from ${claimed.currentState} at stage '${claimed.currentStageId}'`,
  });

  try {
    const finalExecution = await workflowEngine.advance(claimed, version, request.payload);
    await reviewService.ensureReviewForPausedExecution(finalExecution, version);

    await auditService.record({
      executionId: claimed._id,
      requestId: claimed.requestId,
      workflowId: claimed.workflowId,
      workflowVersionNumber: claimed.workflowVersionNumber,
      eventType: 'RECOVERY_COMPLETED',
      actor,
      decisionReason: `Recovery resumed execution to state ${finalExecution.currentState}`,
    });

    return { outcome: 'resumed', execution: finalExecution };
  } catch (err) {
    const isVersionConflict = err.name === 'VersionError';
    await auditService.record({
      executionId: claimed._id,
      requestId: claimed.requestId,
      workflowId: claimed.workflowId,
      workflowVersionNumber: claimed.workflowVersionNumber,
      eventType: isVersionConflict ? 'CONCURRENCY_CONFLICT' : 'RECOVERY_FAILED',
      actor,
      decisionReason: isVersionConflict
        ? 'Another process advanced this execution concurrently; this recovery attempt backed off'
        : `Recovery failed: ${err.message}`,
      errorInfo: isVersionConflict ? null : { message: err.message },
    });
    if (isVersionConflict) {
      return { outcome: 'concurrency-conflict', executionId };
    }
    throw err;
  }
}

/**
 * Resumes a due RetryRecord: atomically claims it, resumes its execution, and
 * marks the record's final outcome. Safe to call concurrently for different
 * records, and safe to call twice for the same record (the claim is a no-op
 * the second time).
 */
async function processRetryRecord(record) {
  const claimed = await retryService.claimRetry(record._id);
  if (!claimed) return { outcome: 'already-claimed', retryRecordId: record._id };

  try {
    const result = await resumeExecution(record.executionId, { actor: 'retry-scheduler', expectedState: 'RETRY_PENDING' });

    if (result.outcome === 'resumed') {
      const succeeded = result.execution.currentState !== 'FAILED' && result.execution.currentState !== 'RETRY_PENDING';
      await (succeeded ? retryService.markSucceeded(claimed._id) : retryService.markFailed(claimed._id));
    } else if (result.outcome === 'concurrency-conflict' || result.outcome === 'already-claimed') {
      // Someone else is handling it (or already did) — leave the retry record's
      // claim marker set; it won't be picked up again since result is no longer 'pending'.
      await retryService.markFailed(claimed._id);
    }
    return result;
  } catch (err) {
    await retryService.markFailed(claimed._id);
    throw err;
  }
}

/**
 * Reconciles ExternalDependencyLog rows stuck in 'pending' (the process died
 * between making the simulated call and recording its outcome). These are
 * marked as an inconclusive failure — never silently assumed successful — so
 * the owning execution's own retry/failure handling (already independent of
 * this reconciliation) can take it from there on its next resume.
 */
async function reconcilePendingDependencyLogs(now = new Date()) {
  const stuck = await findPendingDependencyLogs(now);
  const reconciled = [];

  for (const log of stuck) {
    const updated = await ExternalDependencyLog.findOneAndUpdate(
      { _id: log._id, status: 'pending' },
      {
        $set: {
          status: 'completed',
          simulatedOutcome: 'FAILURE',
          success: false,
          errorCategory: 'transient',
          responsePayload: { error: 'Reconciled: operation left inconclusive by an interrupted process' },
        },
      },
      { new: true }
    );
    if (updated) {
      reconciled.push(updated);
      await auditService.record({
        executionId: updated.executionId,
        eventType: 'RECOVERY_COMPLETED',
        actor: 'recovery-sweep',
        decisionReason: `Reconciled inconclusive dependency call '${updated.dependencyKey}' (operation ${updated.operationId}) as failed`,
      });
    }
  }

  return reconciled;
}

/**
 * The full recovery pass: due retries, stuck PROCESSING executions, and
 * inconclusive dependency checkpoints. Called on an interval by
 * jobs/retryScheduler.js, and directly/synchronously by tests and the manual
 * admin "retry now" endpoint. Idempotent and safe to run concurrently or
 * repeatedly — every sub-operation is independently claim-guarded.
 */
async function runRecoverySweep(now = new Date()) {
  const dueRetries = await retryService.findDueRetries(now);
  const retryResults = [];
  for (const record of dueRetries) {
    retryResults.push(await processRetryRecord(record));
  }

  const reconciledLogs = await reconcilePendingDependencyLogs(now);

  const interrupted = await findInterruptedExecutions(now);
  const interruptedResults = [];
  for (const exec of interrupted) {
    interruptedResults.push(await resumeExecution(exec._id, { actor: 'recovery-sweep', expectedState: 'PROCESSING' }));
  }

  return {
    retriesProcessed: retryResults.length,
    dependencyLogsReconciled: reconciledLogs.length,
    interruptedExecutionsRecovered: interruptedResults.length,
    retryResults,
    interruptedResults,
  };
}

async function listRecoveryCandidates({ page = 1, limit = 20 } = {}) {
  const now = new Date();
  const [interrupted, dueRetries] = await Promise.all([findInterruptedExecutions(now), retryService.findDueRetries(now)]);

  const items = [
    ...interrupted.map((e) => ({
      kind: 'interrupted_execution',
      executionId: e._id,
      lastKnownState: e.currentState,
      lastCompletedStage: e.currentStageId,
      updatedAt: e.updatedAt,
    })),
    ...dueRetries.map((r) => ({
      kind: 'due_retry',
      executionId: r.executionId,
      retryRecordId: r._id,
      attemptNumber: r.attemptNumber,
      scheduledAt: r.scheduledAt,
    })),
  ];

  const skip = (page - 1) * limit;
  return { items: items.slice(skip, skip + limit), total: items.length, page: Number(page), limit: Number(limit) };
}

module.exports = {
  findInterruptedExecutions,
  findPendingDependencyLogs,
  resumeExecution,
  processRetryRecord,
  reconcilePendingDependencyLogs,
  runRecoverySweep,
  listRecoveryCandidates,
  STUCK_PROCESSING_MS,
  STUCK_PENDING_DEPENDENCY_MS,
};
