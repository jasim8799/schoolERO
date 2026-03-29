const mongoose = require('mongoose');
const ObjectId = mongoose.Schema.Types.ObjectId;

const EventLogSchema = new mongoose.Schema({
  schoolId: { type: ObjectId, ref: 'School', required: true },
  event: {
    type: String,
    enum: [
      'STUDENT_ENQUIRY',
      'STUDENT_REGISTERED',
      'STUDENT_APPROVED',
      'STUDENT_ACTIVATED',
      'STUDENT_PROMOTED',
      'STUDENT_LEFT',
      'TC_ISSUED',
      'ATTENDANCE_MARKED',
      'ATTENDANCE_LOCKED',
      'FEE_ASSIGNED',
      'FEE_PAID',
      'FEE_DUE',
      'EXAM_CREATED',
      'RESULT_PUBLISHED',
      'SALARY_CALCULATED',
      'SALARY_PAID',
      'STAFF_CREATED',
      'SESSION_STARTED',
      'SESSION_CLOSED',
      'HOMEWORK_ASSIGNED',
      'NOTICE_SENT'
    ],
    required: true
  },
  entityId: { type: ObjectId },
  entityType: { type: String },
  triggeredBy: { type: ObjectId, ref: 'User' },
  payload: { type: mongoose.Schema.Types.Mixed },
  processedBy: [{ type: String }]  // which automations ran
}, { timestamps: true });

EventLogSchema.index({ schoolId: 1, event: 1 });
EventLogSchema.index({ schoolId: 1, createdAt: -1 });

module.exports = mongoose.model('EventLog', EventLogSchema);
