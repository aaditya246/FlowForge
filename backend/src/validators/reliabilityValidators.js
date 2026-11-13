const Joi = require('joi');
const { VALID_OUTCOMES } = require('../services/externalDependency');

const listRetriesQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  executionId: Joi.string().hex().length(24).optional(),
  result: Joi.string().valid('pending', 'succeeded', 'failed', 'exhausted').optional(),
});

const listRecoveryQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

const upsertSimulationSchema = Joi.object({
  forcedOutcome: Joi.string()
    .valid(...VALID_OUTCOMES)
    .optional(),
  delayMs: Joi.number().min(0).optional(),
  failureProbability: Joi.number().min(0).max(1).optional(),
}).min(1);

const listDependencyLogsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  dependencyKey: Joi.string().optional(),
  executionId: Joi.string().hex().length(24).optional(),
});

module.exports = {
  listRetriesQuerySchema,
  listRecoveryQuerySchema,
  upsertSimulationSchema,
  listDependencyLogsQuerySchema,
};
