const WorkflowExecution = require('../models/WorkflowExecution');
const RetryRecord = require('../models/RetryRecord');
const ExternalDependencyLog = require('../models/ExternalDependencyLog');
const IdempotencyRecord = require('../models/IdempotencyRecord');
const recoveryService = require('../services/recoveryService');
const { sendSuccess } = require('../utils/ApiResponse');

async function getSummary(req, res) {
  const now = new Date();

  const [
    pendingRetries,
    exhaustedRetries,
    interruptedExecutions,
    recentDependencyFailures,
    idempotencyReplays,
    stateCounts,
  ] = await Promise.all([
    RetryRecord.countDocuments({ result: 'pending' }),
    RetryRecord.countDocuments({ result: 'exhausted' }),
    recoveryService.findInterruptedExecutions(now),
    ExternalDependencyLog.countDocuments({ success: false, createdAt: { $gte: new Date(now - 24 * 60 * 60 * 1000) } }),
    IdempotencyRecord.countDocuments({ status: 'completed' }),
    WorkflowExecution.aggregate([{ $group: { _id: '$currentState', count: { $sum: 1 } } }]),
  ]);

  sendSuccess(res, 200, {
    pendingRetries,
    exhaustedRetries,
    interruptedExecutionsCount: interruptedExecutions.length,
    recentDependencyFailures,
    idempotencyRecordsCompleted: idempotencyReplays,
    executionsByState: stateCounts.reduce((acc, s) => ({ ...acc, [s._id]: s.count }), {}),
    generatedAt: now,
  });
}

module.exports = { getSummary };
