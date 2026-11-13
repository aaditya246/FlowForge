const notificationService = require('../services/notificationService');
const { sendSuccess } = require('../utils/ApiResponse');

async function list(req, res) {
  const result = await notificationService.listForUser(req.user._id, req.query);
  sendSuccess(res, 200, result);
}

async function unreadCount(req, res) {
  const count = await notificationService.getUnreadCount(req.user._id);
  sendSuccess(res, 200, { count });
}

async function markRead(req, res) {
  const notification = await notificationService.markRead(req.params.id, req.user._id);
  sendSuccess(res, 200, { notification });
}

async function markAllRead(req, res) {
  const result = await notificationService.markAllRead(req.user._id);
  sendSuccess(res, 200, result);
}

module.exports = { list, unreadCount, markRead, markAllRead };
