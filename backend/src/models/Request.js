const mongoose = require('mongoose');

const requestSchema = new mongoose.Schema(
  {
    workflowId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkflowDefinition', required: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    payloadHash: { type: String, required: true },
    idempotencyKey: { type: String, default: null },
    status: { type: String, enum: ['accepted', 'rejected_invalid'], default: 'accepted' },
    validationErrors: { type: mongoose.Schema.Types.Mixed, default: null },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

requestSchema.index({ workflowId: 1, createdAt: -1 });
requestSchema.index({ idempotencyKey: 1 });

module.exports = mongoose.model('Request', requestSchema);
