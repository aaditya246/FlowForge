const Joi = require('joi');

const createWorkflowSchema = Joi.object({
  name: Joi.string().trim().min(2).max(150).required(),
  slug: Joi.string()
    .trim()
    .lowercase()
    .pattern(/^[a-z0-9-]+$/)
    .min(2)
    .max(100)
    .required(),
  description: Joi.string().allow('').max(2000).default(''),
});

const updateWorkflowSchema = Joi.object({
  name: Joi.string().trim().min(2).max(150),
  description: Joi.string().allow('').max(2000),
  status: Joi.string().valid('active', 'inactive', 'archived'),
}).min(1);

module.exports = { createWorkflowSchema, updateWorkflowSchema };
