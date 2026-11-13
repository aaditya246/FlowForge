const mongoose = require('mongoose');

// Append-only decision/action trail. Must never be mutated after creation.
const auditLogSchema = new mongoose.Schema(
  {
    executionId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkflowExecution', default: null },
    requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'Request', default: null },
    workflowId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkflowDefinition', default: null },
    workflowVersionNumber: { type: Number, default: null },
    eventType: {
      type: String,
      required: true,
      enum: [
        'REQUEST_SUBMITTED',
        'VALIDATION_RESULT',
        'WORKFLOW_INITIALIZED',
        'RULE_EVALUATION',
        'STAGE_TRANSITION',
        'EXTERNAL_DEPENDENCY_CALL',
        'EXTERNAL_DEPENDENCY_RESPONSE',
        'FAILURE',
        'RETRY_ATTEMPT',
        'MANUAL_REVIEW_ROUTED',
        'MANUAL_DECISION',
        'CONFIG_CHANGE',
        'EXECUTION_COMPLETED',
        // Phase 5 — reliability events
        'IDEMPOTENCY_REPLAY',
        'IDEMPOTENCY_CONFLICT',
        'IDEMPOTENCY_IN_PROGRESS',
        'RETRY_SCHEDULED',
        'RETRY_STARTED',
        'RETRY_SUCCEEDED',
        'RETRY_FAILED',
        'RETRY_EXHAUSTED',
        'DEPENDENCY_TIMEOUT',
        'DEPENDENCY_FAILURE',
        'RECOVERY_STARTED',
        'RECOVERY_COMPLETED',
        'RECOVERY_FAILED',
        'CONCURRENCY_CONFLICT',
        // Phase 6 — human-in-the-loop review events
        'REVIEW_CREATED',
        'REVIEW_ASSIGNED',
        'REVIEW_REASSIGNED',
        'REVIEW_UNASSIGNED',
        'REVIEW_STARTED',
        'REVIEW_ESCALATED',
        'REVIEW_INFORMATION_REQUESTED',
        'REVIEW_INFORMATION_SUBMITTED',
        'REVIEW_COMPLETED',
        'WORKFLOW_RESUMED',
      ],
    },
    actor: { type: String, default: 'system' },
    ruleTrace: { type: [mongoose.Schema.Types.Mixed], default: undefined },
    decisionReason: { type: String, default: null },
    dataRef: { type: String, default: null }, // e.g. requestId + payloadHash, never raw sensitive payload
    errorInfo: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ executionId: 1, createdAt: 1 });
auditLogSchema.index({ requestId: 1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
