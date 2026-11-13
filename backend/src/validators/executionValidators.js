const Joi = require('joi');

const submitRequestSchema = Joi.object({
  workflowId: Joi.string().hex().length(24).required(),
  payload: Joi.object().unknown(true).required(),
  idempotencyKey: Joi.string().allow(null).default(null),
});

const listQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  workflowId: Joi.string().hex().length(24).optional(),
  status: Joi.string().optional(),
  currentState: Joi.string().optional(),
});

module.exports = { submitRequestSchema, listQuerySchema };
