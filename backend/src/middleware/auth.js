const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/env');
const ApiError = require('../utils/ApiError');
const User = require('../models/User');

async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw ApiError.unauthorized('Missing or malformed authorization header');
  }

  let payload;
  try {
    payload = jwt.verify(token, jwtSecret);
  } catch (err) {
    throw ApiError.unauthorized('Invalid or expired token');
  }

  let user;
  try {
    user = await User.findById(payload.sub).select('-passwordHash');
  } catch (err) {
    // Malformed sub claim (e.g. not a valid ObjectId) — treat as an auth failure, not a bad request.
    throw ApiError.unauthorized('Invalid or expired token');
  }
  if (!user || !user.isActive) {
    throw ApiError.unauthorized('User not found or inactive');
  }

  req.user = user;
  next();
}

function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      throw ApiError.unauthorized();
    }
    if (!allowedRoles.includes(req.user.role)) {
      throw ApiError.forbidden(`Role '${req.user.role}' is not permitted to perform this action`);
    }
    next();
  };
}

module.exports = { authenticate, authorize };
