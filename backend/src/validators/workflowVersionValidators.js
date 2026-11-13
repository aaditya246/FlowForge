const Joi = require('joi');

// Recursive condition AST schema (leaf or and/or/not), mirrors services/ruleEngine's shape.
const conditionSchema = Joi.object({
  field: Joi.string(),
  operator: Joi.string(),
  value: Joi.any(),
  and: Joi.array().items(Joi.link('#conditionNode')),
  or: Joi.array().items(Joi.link('#conditionNode')),
  not: Joi.link('#conditionNode'),
})
  .unknown(false)
  .id('conditionNode');

const ruleSchema = Joi.object({
  ruleId: Joi.string().required(),
  name: Joi.string().required(),
  description: Joi.string().allow('').default(''),
  priority: Joi.number().default(0),
  enabled: Joi.boolean().default(true),
  group: Joi.string().default('default'),
  condition: conditionSchema.required(),
  onPass: Joi.string().valid('CONTINUE', 'APPROVE', 'REJECT', 'MANUAL_REVIEW', 'RETRY').default('CONTINUE'),
  onFail: Joi.string()
    .valid('CONTINUE', 'APPROVE', 'REJECT', 'MANUAL_REVIEW', 'RETRY', 'FAIL')
    .default('CONTINUE'),
});

const fieldDefSchema = Joi.object({
  name: Joi.string().required(),
  type: Joi.string().valid('string', 'number', 'boolean', 'date', 'array').required(),
  required: Joi.boolean().default(false),
  enum: Joi.array().items(Joi.any()),
  min: Joi.number(),
  max: Joi.number(),
});

const stageSchema = Joi.object({
  stageId: Joi.string().required(),
  name: Joi.string().required(),
  order: Joi.number().required(),
  type: Joi.string().valid('validation', 'rule_evaluation', 'external_dependency', 'manual_review', 'terminal').required(),
  ruleGroup: Joi.string().allow(null).default(null),
  externalDependencyKey: Joi.string().allow(null).default(null),
  timeoutMs: Joi.number().min(0).default(5000),
  retry: Joi.object({
    maxAttempts: Joi.number().min(0).default(0),
    delayMs: Joi.number().min(0).default(0),
    backoff: Joi.string().valid('fixed', 'exponential').default('fixed'),
    backoffMultiplier: Joi.number().min(1).default(2),
    maxDelayMs: Joi.number().min(0).default(30000),
    jitter: Joi.boolean().default(false),
  }).default({}),
  onSuccess: Joi.string().allow(null).default(null),
  onFailure: Joi.string().allow(null).default(null),
  onManualReview: Joi.string().allow(null).default(null),
  reviewSlaMs: Joi.number().min(0).allow(null).default(null),
  reviewEscalationThresholdMs: Joi.number().min(0).allow(null).default(null),
  reviewPriority: Joi.string().valid('low', 'normal', 'high', 'urgent').allow(null).default(null),
});

const createVersionSchema = Joi.object({
  cloneFromVersion: Joi.number().integer().min(1).optional(),
});

const updateVersionSchema = Joi.object({
  inputSchema: Joi.array().items(fieldDefSchema),
  stages: Joi.array().items(stageSchema),
  rules: Joi.array().items(ruleSchema),
  startStageId: Joi.string().allow(null),
  conflictResolution: Joi.string().valid('priority', 'first_match', 'all_must_pass'),
}).min(1);

const testRulesSchema = Joi.object({
  rules: Joi.array().items(ruleSchema).required(),
  context: Joi.object().unknown(true).default({}),
  conflictResolution: Joi.string().valid('priority', 'first_match', 'all_must_pass').default('priority'),
});

const testContextSchema = Joi.object({
  context: Joi.object().unknown(true).default({}),
});

module.exports = {
  createVersionSchema,
  updateVersionSchema,
  testRulesSchema,
  testContextSchema,
  ruleSchema,
  conditionSchema,
};
