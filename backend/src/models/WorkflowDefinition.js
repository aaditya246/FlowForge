const mongoose = require('mongoose');

const workflowDefinitionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, default: '' },
    status: { type: String, enum: ['active', 'inactive', 'archived'], default: 'active' },
    currentPublishedVersion: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('WorkflowDefinition', workflowDefinitionSchema);
