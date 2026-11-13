const mongoose = require('mongoose');

const NOTIFICATION_TYPES = [
  'REVIEW_ASSIGNED',
  'REVIEW_REASSIGNED',
  'INFORMATION_REQUESTED',
  'INFORMATION_SUBMITTED',
  'REVIEW_ESCALATED',
  'REVIEW_OVERDUE',
  'REVIEW_APPROVED',
  'REVIEW_REJECTED',
];

// In-app notification. Deliberately extensible: `type` + `data` carry enough
// structured info that an email/webhook channel could be added later without
// changing this model — see services/notificationService.
const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    link: { type: String, default: null }, // e.g. /reviews/:id — never a raw payload
    data: { type: mongoose.Schema.Types.Mixed, default: null }, // small structured refs only (reviewId, executionId) — never sensitive request data
    read: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
module.exports.NOTIFICATION_TYPES = NOTIFICATION_TYPES;
