const mongoose = require('mongoose');

const ACTION_TYPES = [
  'CREATED',
  'ASSIGNED',
  'REASSIGNED',
  'UNASSIGNED',
  'STARTED',
  'APPROVED',
  'REJECTED',
  'MORE_INFORMATION_REQUESTED',
  'INFORMATION_SUBMITTED',
  'ESCALATED',
  'CANCELLED',
  'WORKFLOW_RESUMED',
];

// Append-only history of every action taken against a ManualReview. Never
// updated or deleted — this is the audit trail a user reconstructs the full
// human-review history from.
const reviewActionSchema = new mongoose.Schema(
  {
    reviewId: { type: mongoose.Schema.Types.ObjectId, ref: 'ManualReview', required: true },
    executionId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkflowExecution', required: true },
    actionType: { type: String, enum: ACTION_TYPES, required: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // null for system-initiated actions
    actorRole: { type: String, default: null },
    previousStatus: { type: String, default: null },
    newStatus: { type: String, default: null },
    // Kept for backward-compatible read access to older-style records.
    decision: { type: String, enum: ['APPROVE', 'REJECT', null], default: null },
    comment: { type: String, default: '' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

reviewActionSchema.index({ reviewId: 1, createdAt: 1 });
reviewActionSchema.index({ executionId: 1, createdAt: -1 });

module.exports = mongoose.model('ReviewAction', reviewActionSchema);
module.exports.ACTION_TYPES = ACTION_TYPES;
