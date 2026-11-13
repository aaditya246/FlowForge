const Joi = require('joi');

const listReviewsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  status: Joi.string().valid('PENDING', 'ASSIGNED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'MORE_INFORMATION_REQUIRED', 'CANCELLED', 'ESCALATED').optional(),
  assignedReviewerId: Joi.string().hex().length(24).optional(),
  unassigned: Joi.boolean().optional(),
  workflowId: Joi.string().hex().length(24).optional(),
  priority: Joi.string().valid('low', 'normal', 'high', 'urgent').optional(),
  escalatedOnly: Joi.boolean().optional(),
  overdueOnly: Joi.boolean().optional(),
  search: Joi.string().max(200).optional(),
  sortBy: Joi.string().valid('createdAt', 'dueAt', 'priority', 'status').default('createdAt'),
  sortDir: Joi.string().valid('asc', 'desc').default('desc'),
});

const assignSchema = Joi.object({
  reviewerId: Joi.string().hex().length(24).required(),
});

const decisionSchema = Joi.object({
  comment: Joi.string().trim().min(1).required(),
});

const infoRequestSchema = Joi.object({
  explanation: Joi.string().trim().min(1).required(),
});

const infoSubmitSchema = Joi.object({
  text: Joi.string().trim().min(1).required(),
});

const escalateSchema = Joi.object({
  reason: Joi.string().trim().min(1).required(),
});

module.exports = {
  listReviewsQuerySchema,
  assignSchema,
  decisionSchema,
  infoRequestSchema,
  infoSubmitSchema,
  escalateSchema,
};
