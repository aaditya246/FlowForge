const Joi = require('joi');
const { ROLES } = require('../models/User');

const registerSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  email: Joi.string()
    .trim()
    .email({ tlds: { allow: false } })
    .required(),
  password: Joi.string().min(8).max(128).required(),
  role: Joi.string()
    .valid(...ROLES)
    .default('operator'),
});

const loginSchema = Joi.object({
  email: Joi.string()
    .trim()
    .email({ tlds: { allow: false } })
    .required(),
  password: Joi.string().required(),
});

module.exports = { registerSchema, loginSchema };
