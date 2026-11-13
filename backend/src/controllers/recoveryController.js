const recoveryService = require('../services/recoveryService');
const WorkflowExecution = require('../models/WorkflowExecution');
const ApiError = require('../utils/ApiError');
const { sendSuccess } = require('../utils/ApiResponse');

async function listRecovery(req, res) {
  const result = await recoveryService.listRecoveryCandidates(req.query);
  sendSuccess(res, 200, result);
}

async function getRecoveryItem(req, res) {
  const execution = await WorkflowExecution.findById(req.params.id).lean();
  if (!execution) throw ApiError.notFound('Execution not found');
  sendSuccess(res, 200, {
    executionId: execution._id,
    lastKnownState: execution.currentState,
    lastCompletedStage: execution.currentStageId,
    retryCount: execution.retryCount,
    updatedAt: execution.updatedAt,
  });
}

/**
 * Manually triggers recovery for a single execution. Admin-only. Reuses the
 * same claim-guarded resumeExecution path the automatic sweep uses — it cannot
 * bypass state validation or double-resume an execution another process is
 * already handling (it simply reports 'concurrency-conflict' if so).
 */
async function triggerRecovery(req, res) {
  const execution = await WorkflowExecution.findById(req.params.id).lean();
  if (!execution) throw ApiError.notFound('Execution not found');

  if (!['PROCESSING', 'RETRY_PENDING'].includes(execution.currentState)) {
    throw ApiError.conflict(`Execution is in state '${execution.currentState}' and is not eligible for manual recovery`);
  }

  const result = await recoveryService.resumeExecution(execution._id, {
    actor: `admin:${req.user._id}`,
    expectedState: execution.currentState,
  });

  sendSuccess(res, 200, result);
}

module.exports = { listRecovery, getRecoveryItem, triggerRecovery };
