import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema({
  action: {
    type: String,
    required: [true, 'Action is required'],
    enum: [
      'LOGIN',
      'LOGOUT',
      'USER_CREATED',
      'USER_UPDATED',
      'USER_DELETED',
      'ROLE_CHANGED',
      'SCHOOL_CREATED',
      'SESSION_CREATED',
      'SESSION_ACTIVATED',
      'PASSWORD_CHANGED',
      'CLASS_CREATED',
      'SECTION_CREATED',
      'SUBJECT_CREATED',
      'TEACHER_CREATED',
      'PARENT_CREATED',
      'STUDENT_CREATED'
    ]
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required']
  },
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School'
  },
  targetUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  details: {
    type: mongoose.Schema.Types.Mixed
  },
  ipAddress: {
    type: String
  },
  userAgent: {
    type: String
  }
}, {
  timestamps: true
});

// Index for efficient queries
auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ schoolId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

export default AuditLog;
