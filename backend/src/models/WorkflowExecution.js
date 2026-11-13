const mongoose = require('mongoose');

const STATES = [
  'PENDING',
  'VALIDATING',
  'PROCESSING',
  'APPROVED',
  'REJECTED',
  'MANUAL_REVIEW',
  'RETRY_PENDING',
  'FAILED',
  'COMPLETED',
];

const workflowExecutionSchema = new mongoose.Schema(
  {
    requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'Request', required: true },
    workflowId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkflowDefinition', required: true },
    workflowVersionId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkflowVersion', required: true },
    workflowVersionNumber: { type: Number, required: true },
    currentState: { type: String, enum: STATES, default: 'PENDING' },
    currentStageId: { type: String, default: null },
    retryCount: { type: Number, default: 0 },
    // A decision (APPROVE/REJECT) made by an earlier rule_evaluation stage but not yet
    // applied at a terminal stage — persisted so it survives a MANUAL_REVIEW/RETRY_PENDING
    // pause in between. Never read by API consumers; use finalDecision for the real outcome.
    pendingDecision: { type: String, enum: ['APPROVE', 'REJECT', null], default: null },
    finalDecision: { type: String, enum: ['APPROVE', 'REJECT', null], default: null },
    finalReason: { type: String, default: null },
    completedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    // Optimistic concurrency control: every .save() checks the in-memory __v
    // against the stored value and throws a VersionError on mismatch. This is
    // the concurrency guard against two workers (e.g. a retry-sweep resume and
    // a late/duplicate dependency callback) both trying to advance the same
    // execution from a stale in-memory copy — see services/workflowEngine and
    // services/recoveryService, which both catch VersionError explicitly.
    optimisticConcurrency: true,
  }
);

workflowExecutionSchema.index({ requestId: 1 }, { unique: true });
workflowExecutionSchema.index({ workflowId: 1, currentState: 1 });

module.exports = mongoose.model('WorkflowExecution', workflowExecutionSchema);
module.exports.STATES = STATES;
