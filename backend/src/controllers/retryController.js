const RetryRecord = require('../models/RetryRecord');
const ApiError = require('../utils/ApiError');
const { sendSuccess } = require('../utils/ApiResponse');

async function listRetries(req, res) {
  const { page = 1, limit = 20, executionId, result } = req.query;
  const filter = {};
  if (executionId) filter.executionId = executionId;
  if (result) filter.result = result;

  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    RetryRecord.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
    RetryRecord.countDocuments(filter),
  ]);

  sendSuccess(res, 200, { items, total, page: Number(page), limit: Number(limit) });
}

async function getRetry(req, res) {
  const record = await RetryRecord.findById(req.params.id).lean();
  if (!record) throw ApiError.notFound('Retry record not found');
  sendSuccess(res, 200, { retry: record });
}

async function listRetriesForExecution(req, res) {
  const records = await RetryRecord.find({ executionId: req.params.id }).sort({ attemptNumber: 1 }).lean();
  sendSuccess(res, 200, { retries: records });
}

module.exports = { listRetries, getRetry, listRetriesForExecution };
