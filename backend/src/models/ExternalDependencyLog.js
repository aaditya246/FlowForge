const mongoose = require('mongoose');

const externalDependencyLogSchema = new mongoose.Schema(
  {
    executionId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkflowExecution', required: true },
    dependencyKey: { type: String, required: true }, // e.g. 'credit_bureau', 'identity_verification'
    // Deterministic per-attempt identifier (executionId:stageId:attemptN). Used as an
    // outbox-style checkpoint: a call is logged 'pending' BEFORE being simulated, then
    // updated to its final outcome. On recovery, a completed log for the same
    // operationId is reused instead of re-triggering the (potential) side effect —
    // this is what distinguishes "retry the failed request" (new operationId) from
    // "don't repeat an already-succeeded side effect" (same operationId, replayed).
    operationId: { type: String, default: null },
    status: { type: String, enum: ['pending', 'completed'], default: 'completed' },
    requestPayload: { type: mongoose.Schema.Types.Mixed, default: null },
    simulatedOutcome: {
      type: String,
      enum: ['SUCCESS', 'FAILURE', 'TIMEOUT', 'INTERMITTENT_FAILURE', 'SLOW_RESPONSE', null],
      default: null,
    },
    errorCategory: { type: String, default: null }, // e.g. 'transient', 'timeout', 'permanent'
    responsePayload: { type: mongoose.Schema.Types.Mixed, default: null },
    latencyMs: { type: Number, default: 0 },
    success: { type: Boolean, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

externalDependencyLogSchema.index({ executionId: 1, createdAt: 1 });
// Sparse + unique: only enforced when operationId is actually set, so a given
// (execution, operation) pair can have at most one log row — the outbox checkpoint.
externalDependencyLogSchema.index({ executionId: 1, operationId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('ExternalDependencyLog', externalDependencyLogSchema);
