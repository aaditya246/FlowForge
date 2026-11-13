const ApiError = require('../utils/ApiError');

function notFoundHandler(req, res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let error = err;

  if (!(error instanceof ApiError)) {
    if (error.type === 'entity.parse.failed') {
      error = ApiError.badRequest('Malformed JSON in request body');
    } else if (error.name === 'ValidationError') {
      error = ApiError.badRequest('Validation failed', error.errors);
    } else if (error.code === 11000) {
      error = ApiError.conflict('Duplicate key violation', error.keyValue);
    } else if (error.name === 'CastError') {
      error = ApiError.badRequest(`Invalid value for ${error.path}`);
    } else {
      error = ApiError.internal(
        process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message
      );
    }
  }

  if (process.env.NODE_ENV !== 'test' && error.statusCode >= 500) {
    // eslint-disable-next-line no-console
    console.error(err);
  }

  res.status(error.statusCode || 500).json({
    success: false,
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: error.message,
      details: error.details || undefined,
    },
  });
}

module.exports = { notFoundHandler, errorHandler };
