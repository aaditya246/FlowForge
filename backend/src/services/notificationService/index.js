/**
 * In-app notification service. Deliberately minimal and extensible: every
 * other channel (email, webhook, push) would plug in here as an additional
 * delivery step inside createNotification without changing any caller —
 * reviewService/workflowEngine never need to know how a notification is
 * actually delivered.
 */
const Notification = require('../../models/Notification');
const ApiError = require('../../utils/ApiError');

async function createNotification({ userId, type, title, message, link = null, data = null }) {
  return Notification.create({ userId, type, title, message, link, data });
}

async function listForUser(userId, { page = 1, limit = 20, unreadOnly = false } = {}) {
  const filter = { userId };
  if (unreadOnly) filter.read = false;

  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
    Notification.countDocuments(filter),
  ]);

  return { items, total, page: Number(page), limit: Number(limit) };
}

async function getUnreadCount(userId) {
  return Notification.countDocuments({ userId, read: false });
}

async function markRead(notificationId, userId) {
  const notification = await Notification.findOneAndUpdate(
    { _id: notificationId, userId },
    { $set: { read: true, readAt: new Date() } },
    { new: true }
  );
  if (!notification) throw ApiError.notFound('Notification not found');
  return notification;
}

async function markAllRead(userId) {
  const result = await Notification.updateMany({ userId, read: false }, { $set: { read: true, readAt: new Date() } });
  return { modifiedCount: result.modifiedCount };
}

module.exports = { createNotification, listForUser, getUnreadCount, markRead, markAllRead };
