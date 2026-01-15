const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  role: {
    type: String,
    required: true,
    enum: ['SUPER_ADMIN', 'PRINCIPAL', 'OPERATOR', 'TEACHER', 'STUDENT', 'PARENT']
  },
  action: {
    type: String,
    required: true,
    enum: [
      // Authentication
      'LOGIN',
      'LOGOUT',
      'PASSWORD_CHANGED',

      // User Management
      'USER_CREATED',
      'USER_UPDATED',
      'USER_DELETED',
      'ROLE_CHANGED',

      // School Management
      'SCHOOL_CREATED',
      'SCHOOL_UPDATED',

      // Session Management
      'SESSION_CREATED',
      'SESSION_ACTIVATED',
      'SESSION_UPDATED',

      // Academic
      'CLASS_CREATED',
      'CLASS_UPDATED',
      'SECTION_CREATED',
      'SECTION_UPDATED',
      'SUBJECT_CREATED',
      'SUBJECT_UPDATED',
      'TEACHER_CREATED',
      'TEACHER_UPDATED',
      'STUDENT_CREATED',
      'STUDENT_UPDATED',
      'PARENT_CREATED',
      'PARENT_UPDATED',

      // Exams
      'EXAM_CREATED',
      'EXAM_UPDATED',
      'EXAM_DELETED',
      'EXAM_FORM_CREATED',
      'EXAM_PAYMENT_PROCESSED',
      'RESULT_ENTERED',
      'ADMIT_CARD_GENERATED',

      // Fees
      'FEE_STRUCTURE_CREATED',
      'FEE_STRUCTURE_UPDATED',
      'FEE_PAYMENT_PROCESSED',
      'FEE_RECEIPT_GENERATED',

      // Salary
      'SALARY_PROFILE_CREATED',
      'SALARY_CALCULATED',
      'SALARY_PAYMENT_PROCESSED',

      // Expenses
      'EXPENSE_CREATED',
      'EXPENSE_UPDATED',

      // Backup & Restore
      'BACKUP_CREATED',
      'BACKUP_DOWNLOADED',
      'BACKUP_PREVIEW',
      'RESTORE_PREVIEW',
      'RESTORE_EXECUTED',

      // System
      'BACKUP_COMPLETED',
      'BACKUP_FAILED',
      'RESTORE_EXECUTION_FAILED',
      'RESTORE_PREVIEW_FAILED',
      'BACKUP_DOWNLOAD_FAILED'
    ]
  },
  entityType: {
    type: String,
    required: true,
    enum: [
      'USER',
      'SCHOOL',
      'SESSION',
      'CLASS',
      'SECTION',
      'SUBJECT',
      'TEACHER',
      'STUDENT',
      'PARENT',
      'EXAM',
      'EXAM_FORM',
      'EXAM_PAYMENT',
      'RESULT',
      'ADMIT_CARD',
      'FEE_STRUCTURE',
      'FEE_PAYMENT',
      'SALARY_PROFILE',
      'SALARY_CALCULATION',
      'SALARY_PAYMENT',
      'EXPENSE',
      'BACKUP',
      'SYSTEM'
    ]
  },
  entityId: {
    type: mongoose.Schema.Types.ObjectId,
    required: false // Some actions might not have a specific entity
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  ipAddress: {
    type: String,
    required: true
  },
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    required: false // Super Admin actions might not be school-specific
  },
  sessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AcademicSession',
    required: false
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
AuditLogSchema.index({ userId: 1, createdAt: -1 });
AuditLogSchema.index({ schoolId: 1, createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });
AuditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
AuditLogSchema.index({ createdAt: -1 }); // For date range queries

// Prevent any updates or deletes - logs are immutable
AuditLogSchema.pre('findOneAndUpdate', function(next) {
  throw new Error('Audit logs cannot be modified');
});

AuditLogSchema.pre('findOneAndDelete', function(next) {
  throw new Error('Audit logs cannot be deleted');
});

AuditLogSchema.pre('findOneAndRemove', function(next) {
  throw new Error('Audit logs cannot be removed');
});

// Check if model already exists to avoid OverwriteModelError
if (mongoose.models.AuditLog) {
  module.exports = mongoose.model('AuditLog');
} else {
  module.exports = mongoose.model('AuditLog', AuditLogSchema);
}
