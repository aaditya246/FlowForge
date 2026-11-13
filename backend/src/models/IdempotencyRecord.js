const mongoose = require('mongoose');

const idempotencyRecordSchema = new mongoose.Schema(
  {
    workflowId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkflowDefinition', required: true },
    idempotencyKey: { type: String, required: true },
    payloadHash: { type: String, required: true },
    status: { type: String, enum: ['processing', 'completed', 'failed'], default: 'processing' },
    requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'Request', default: null },
    executionId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkflowExecution', default: null },
    resultSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    // TTL-style expiration for completed/failed records, so the idempotency
    // window doesn't retain data forever. Not enforced by a Mongo TTL index
    // (would delete the audit trail); checked explicitly by idempotencyService.
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Core idempotency guarantee: one key per workflow can only ever claim one execution.
idempotencyRecordSchema.index({ workflowId: 1, idempotencyKey: 1 }, { unique: true });

module.exports = mongoose.model('IdempotencyRecord', idempotencyRecordSchema);
