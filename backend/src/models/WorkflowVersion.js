const mongoose = require('mongoose');

// A single field definition for the workflow's dynamic input schema.
const fieldSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    type: { type: String, enum: ['string', 'number', 'boolean', 'date', 'array'], required: true },
    required: { type: Boolean, default: false },
    enum: { type: [mongoose.Schema.Types.Mixed], default: undefined },
    min: { type: Number, default: undefined },
    max: { type: Number, default: undefined },
  },
  { _id: false }
);

const ruleSchema = new mongoose.Schema(
  {
    ruleId: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    priority: { type: Number, default: 0 },
    enabled: { type: Boolean, default: true },
    group: { type: String, default: 'default' },
    // Declarative AST (safe, no eval). Interpreted by services/ruleEngine.
    condition: { type: mongoose.Schema.Types.Mixed, required: true },
    onPass: { type: String, enum: ['CONTINUE', 'APPROVE', 'REJECT', 'MANUAL_REVIEW', 'RETRY'], default: 'CONTINUE' },
    onFail: { type: String, enum: ['CONTINUE', 'APPROVE', 'REJECT', 'MANUAL_REVIEW', 'RETRY', 'FAIL'], default: 'CONTINUE' },
  },
  { _id: false }
);

const stageSchema = new mongoose.Schema(
  {
    stageId: { type: String, required: true },
    name: { type: String, required: true },
    order: { type: Number, required: true },
    type: {
      type: String,
      enum: ['validation', 'rule_evaluation', 'external_dependency', 'manual_review', 'terminal'],
      required: true,
    },
    ruleGroup: { type: String, default: null },
    externalDependencyKey: { type: String, default: null },
    timeoutMs: { type: Number, default: 5000 }, // external_dependency stages: latency above this is treated as TIMEOUT
    retry: {
      maxAttempts: { type: Number, default: 0 },
      delayMs: { type: Number, default: 0 },
      backoff: { type: String, enum: ['fixed', 'exponential'], default: 'fixed' },
      backoffMultiplier: { type: Number, default: 2 },
      maxDelayMs: { type: Number, default: 30000 },
      jitter: { type: Boolean, default: false },
    },
    onSuccess: { type: String, default: null }, // next stageId
    onFailure: { type: String, default: null },
    onManualReview: { type: String, default: null },
    // Phase 6: optional review SLA/priority config for stages that can pause
    // execution for human review. Left null => reviewService falls back to
    // sensible defaults (see services/reviewService).
    reviewSlaMs: { type: Number, default: null },
    reviewEscalationThresholdMs: { type: Number, default: null },
    reviewPriority: { type: String, enum: ['low', 'normal', 'high', 'urgent', null], default: null },
  },
  { _id: false }
);

const workflowVersionSchema = new mongoose.Schema(
  {
    workflowId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkflowDefinition', required: true },
    version: { type: Number, required: true },
    status: { type: String, enum: ['draft', 'published', 'deprecated'], default: 'draft' },
    inputSchema: { type: [fieldSchema], default: [] },
    stages: { type: [stageSchema], default: [] },
    rules: { type: [ruleSchema], default: [] },
    startStageId: { type: String, default: null }, // required to publish; enforced by validateWorkflowConfig
    conflictResolution: { type: String, enum: ['priority', 'first_match', 'all_must_pass'], default: 'priority' },
    publishedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

workflowVersionSchema.index({ workflowId: 1, version: 1 }, { unique: true });

module.exports = mongoose.model('WorkflowVersion', workflowVersionSchema);
