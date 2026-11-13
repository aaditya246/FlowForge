const AuditLog = require('../../models/AuditLog');

/**
 * Single entrypoint for writing audit records. Every other service must route
 * decision/state-affecting actions through this function so nothing happens
 * without a trace. Audit records are append-only and never updated.
 */
async function record(event) {
  const {
    executionId = null,
    requestId = null,
    workflowId = null,
    workflowVersionNumber = null,
    eventType,
    actor = 'system',
    ruleTrace = undefined,
    decisionReason = null,
    dataRef = null,
    errorInfo = null,
  } = event;

  if (!eventType) {
    throw new Error('auditService.record requires an eventType');
  }

  return AuditLog.create({
    executionId,
    requestId,
    workflowId,
    workflowVersionNumber,
    eventType,
    actor,
    ruleTrace,
    decisionReason,
    dataRef,
    errorInfo,
  });
}

async function getTimelineForExecution(executionId) {
  return AuditLog.find({ executionId }).sort({ createdAt: 1 }).lean();
}

module.exports = { record, getTimelineForExecution };
