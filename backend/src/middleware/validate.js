const ApiError = require('../utils/ApiError');

/**
 * Validates req[part] against a Joi schema. Throws ApiError.badRequest on failure.
 */
function validate(schema, part = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[part], {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const details = error.details.map((d) => ({
        field: d.path.join('.'),
        message: d.message,
      }));
      throw ApiError.badRequest('Request validation failed', details);
    }

    req[part] = value;
    next();
  };
}

module.exports = validate;
