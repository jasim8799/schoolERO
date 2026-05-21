const mongoose = require('mongoose');

const NotificationLogSchema = new mongoose.Schema({
  schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  channel: { type: String, enum: ['EMAIL', 'SMS', 'WHATSAPP', 'PUSH', 'IN_APP'], required: true },
  type: { type: String, required: true },
  recipient: { type: String },
  subject: { type: String },
  message: { type: String },
  status: { type: String, enum: ['PENDING', 'SENT', 'FAILED'], default: 'PENDING', index: true },
  providerMessageId: { type: String },
  error: { type: String },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

NotificationLogSchema.index({ schoolId: 1, createdAt: -1 });

module.exports = mongoose.model('NotificationLog', NotificationLogSchema);
