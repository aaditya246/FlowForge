const executionService = require('../services/executionService');
const { sendSuccess } = require('../utils/ApiResponse');

async function listExecutions(req, res) {
  const result = await executionService.listExecutions(req.query);
  sendSuccess(res, 200, result);
}

async function getExecution(req, res) {
  const execution = await executionService.getExecutionOr404(req.params.id);
  sendSuccess(res, 200, { execution });
}

async function getExecutionStatus(req, res) {
  const execution = await executionService.getExecutionOr404(req.params.id);
  sendSuccess(res, 200, {
    executionId: execution._id,
    currentState: execution.currentState,
    currentStageId: execution.currentStageId,
    finalDecision: execution.finalDecision,
  });
}

async function getExecutionHistory(req, res) {
  const history = await executionService.getExecutionHistory(req.params.id);
  sendSuccess(res, 200, history);
}

async function getExecutionExplanation(req, res) {
  const explanation = await executionService.getExecutionExplanation(req.params.id);
  sendSuccess(res, 200, explanation);
}

module.exports = { listExecutions, getExecution, getExecutionStatus, getExecutionHistory, getExecutionExplanation };
