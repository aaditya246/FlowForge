const executionService = require('../services/executionService');
const { sendSuccess } = require('../utils/ApiResponse');

async function submitRequest(req, res) {
  const { workflowId, payload, idempotencyKey } = req.body;
  const result = await executionService.submitRequest({
    workflowId,
    payload,
    idempotencyKey: idempotencyKey || req.idempotencyKey || null,
    userId: req.user._id,
  });

  const statusCode = result.inProgress ? 202 : result.valid ? (result.replayed ? 200 : 201) : 422;
  sendSuccess(res, statusCode, result);
}

async function listRequests(req, res) {
  const result = await executionService.listRequests(req.query);
  sendSuccess(res, 200, result);
}

async function getRequest(req, res) {
  const request = await executionService.getRequestOr404(req.params.id);
  sendSuccess(res, 200, { request });
}

module.exports = { submitRequest, listRequests, getRequest };
