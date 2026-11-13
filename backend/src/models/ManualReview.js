const mongoose = require('mongoose');

const STATUSES = [
  'PENDING',
  'ASSIGNED',
  'IN_REVIEW',
  'APPROVED',
  'REJECTED',
  'MORE_INFORMATION_REQUIRED',
  'CANCELLED',
  'ESCALATED',
];

const TERMINAL_STATUSES = ['APPROVED', 'REJECTED', 'CANCELLED'];

// One record per time an execution pauses for manual review. Mutable lifecycle
// state (status/assignment/deadline) lives here; the append-only action-by-action
// trail lives in ReviewAction, linked by reviewId.
const manualReviewSchema = new mongoose.Schema(
  {
    requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'Request', required: true },
    executionId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkflowExecution', required: true },
    workflowId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkflowDefinition', required: true },
    workflowVersionId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkflowVersion', required: true },
    stageId: { type: String, required: true }, // the workflow stage execution paused at

    status: { type: String, enum: STATUSES, default: 'PENDING' },
    reason: { type: String, default: '' }, // why manual review was triggered (from the rule trace)

    assignedReviewerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    assignedAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },

    priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
    dueAt: { type: Date, default: null },
    slaMs: { type: Number, default: null },
    escalationThresholdMs: { type: Number, default: null },
    escalatedAt: { type: Date, default: null },
    escalationReason: { type: String, default: null },

    decision: { type: String, enum: ['APPROVE', 'REJECT', null], default: null },
    decisionReason: { type: String, default: null },

    informationRequest: { type: String, default: null }, // set while MORE_INFORMATION_REQUIRED
    informationRequestedAt: { type: Date, default: null },
    submittedInformation: {
      type: [
        {
          text: { type: String, required: true },
          submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
          submittedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
  },
  { timestamps: true, optimisticConcurrency: true }
);

manualReviewSchema.index({ status: 1, createdAt: -1 });
manualReviewSchema.index({ assignedReviewerId: 1, status: 1 });
manualReviewSchema.index({ workflowId: 1, status: 1 });
manualReviewSchema.index({ dueAt: 1 });
manualReviewSchema.index({ executionId: 1 });

module.exports = mongoose.model('ManualReview', manualReviewSchema);
module.exports.STATUSES = STATUSES;
module.exports.TERMINAL_STATUSES = TERMINAL_STATUSES;
