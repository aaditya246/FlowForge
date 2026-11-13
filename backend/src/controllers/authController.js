const authService = require('../services/authService');
const { sendSuccess } = require('../utils/ApiResponse');

function sanitizeUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
  };
}

async function register(req, res) {
  const { user, token } = await authService.register(req.body);
  sendSuccess(res, 201, { user: sanitizeUser(user), token });
}

async function login(req, res) {
  const { user, token } = await authService.login(req.body);
  sendSuccess(res, 200, { user: sanitizeUser(user), token });
}

async function me(req, res) {
  sendSuccess(res, 200, { user: sanitizeUser(req.user) });
}

module.exports = { register, login, me };
