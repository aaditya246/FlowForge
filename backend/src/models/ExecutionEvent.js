const mongoose = require('mongoose');

// Append-only. Never updated or deleted by application code.
const executionEventSchema = new mongoose.Schema(
  {
    executionId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkflowExecution', required: true },
    fromState: { type: String, default: null },
    toState: { type: String, required: true },
    stageId: { type: String, default: null },
    actor: { type: String, default: 'system' }, // 'system' | userId string | 'external_dependency'
    reason: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

executionEventSchema.index({ executionId: 1, createdAt: 1 });

module.exports = mongoose.model('ExecutionEvent', executionEventSchema);
