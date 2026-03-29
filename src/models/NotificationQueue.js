const mongoose = require('mongoose');
const ObjectId = mongoose.Schema.Types.ObjectId;

const NotificationQueueSchema = new mongoose.Schema({
  schoolId: { type: ObjectId, ref: 'School', required: true },
  recipientId: { type: ObjectId, ref: 'User', required: true },
  recipientRole: {
    type: String,
    enum: ['SUPER_ADMIN', 'PRINCIPAL', 'OPERATOR', 'TEACHER', 'STUDENT', 'PARENT']
  },
  type: {
    type: String,
    enum: [
      'FEE_REMINDER',
      'ABSENT_ALERT',
      'EXAM_ALERT',
      'RESULT_READY',
      'GENERAL'
    ],
    required: true
  },
  title: { type: String, required: true },
  body: { type: String, required: true },
  status: {
    type: String,
    enum: ['PENDING', 'SENT', 'FAILED'],
    default: 'PENDING'
  },
  sentAt: { type: Date },
  relatedEntityId: { type: ObjectId },
  relatedEntityType: { type: String },
  retryCount: { type: Number, default: 0 },
  errorMessage: { type: String }
}, { timestamps: true });

NotificationQueueSchema.index({ status: 1, createdAt: 1 });
NotificationQueueSchema.index({ schoolId: 1, recipientId: 1 });

module.exports = mongoose.model('NotificationQueue', NotificationQueueSchema);
