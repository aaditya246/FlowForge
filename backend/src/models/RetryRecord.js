const mongoose = require('mongoose');

const retryRecordSchema = new mongoose.Schema(
  {
    executionId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkflowExecution', required: true },
    attemptNumber: { type: Number, required: true },
    originalError: { type: String, default: null },
    retryReason: { type: String, default: null },
    scheduledAt: { type: Date, required: true },
    executedAt: { type: Date, default: null },
    result: { type: String, enum: ['pending', 'succeeded', 'failed', 'exhausted'], default: 'pending' },
  },
  { timestamps: true }
);

retryRecordSchema.index({ executionId: 1, attemptNumber: 1 });
retryRecordSchema.index({ result: 1, scheduledAt: 1 });

module.exports = mongoose.model('RetryRecord', retryRecordSchema);
