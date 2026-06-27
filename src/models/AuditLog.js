const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  role: {
    type: String,
    required: true,
    enum: ['SUPER_ADMIN', 'PRINCIPAL', 'OPERATOR', 'TEACHER', 'STUDENT', 'PARENT', 'GUEST', 'SYSTEM']
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
      'BACKUP_DOWNLOAD_FAILED',
      'RATE_LIMIT_EXCEEDED',

      // Attendance
      'STUDENT_ATTENDANCE_MARKED',
      'SUBJECT_ATTENDANCE_MARKED',
      'TEACHER_ATTENDANCE_MARKED',

      // Fees (extended)
      'FEE_PAYMENT_MANUAL',
      'FEE_PAYMENT_ONLINE_SUCCESS',
      'FEE_PAYMENT_ONLINE_FAILED',

      // Salary (extended)
      'SALARY_CALCULATION',
      'SALARY_PAYMENT',

      // Inventory
      'INVENTORY_EXPORTED',

      // School admin actions
      'SCHOOL_ACTIVATED',
      'SCHOOL_DEACTIVATED',
      'SCHOOL_LIMITS_UPDATED',
      'SCHOOL_PLAN_UPDATED',
      'SCHOOL_SUBSCRIPTION_RENEWED',
      'SCHOOL_MODULES_UPDATED',
      'SCHOOL_FORCE_LOGOUT',

      // User / staff creation failures
      'OPERATOR_CREATED',
      'OPERATOR_CREATION_FAILED',
      'PARENT_CREATION_FAILED',
      'TEACHER_CREATION_FAILED',
      'STUDENT_CREATION_FAILED',
      'PRINCIPAL_ASSIGNED',

      // System / announcements
      'SYSTEM_ANNOUNCEMENT_CREATED',
      'MAINTENANCE_MODE_ENABLED',
      'MAINTENANCE_MODE_DISABLED',
      'PASSWORD_RESET',
      'STUDENT_USER_LINKED',

      // Admission
      'ADMISSION_CREATED',
      'ADMISSION_UPDATED',
      'ADMISSION_APPROVED',
      'ADMISSION_REJECTED',

      // Attendance (expanded)
      'STAFF_ATTENDANCE_MARKED',
      'ATTENDANCE_UPDATED',
      'ATTENDANCE_DELETED',

      // Homework
      'HOMEWORK_CREATED',
      'HOMEWORK_UPDATED',
      'HOMEWORK_DELETED',
      'HOMEWORK_SUBMITTED',

      // Exam (expanded)
      'EXAM_PUBLISHED',
      'EXAM_SUBJECT_ADDED',
      'EXAM_SUBJECT_UPDATED',
      'ADMIT_CARD_RELEASED',
      'RESULT_PUBLISHED',
      'SEATING_CREATED',
      'QUESTION_PAPER_SUBMITTED',

      // PTM
      'PTM_CREATED',
      'PTM_UPDATED',
      'PTM_BOOKED',
      'PTM_CANCELLED',
      'PTM_ATTENDED',

      // Notice
      'NOTICE_CREATED',
      'NOTICE_UPDATED',
      'NOTICE_DELETED',

      // TC / Promotion
      'PROMOTION_EXECUTED',
      'TC_ISSUED',
      'TC_REQUESTED',

      // Video
      'VIDEO_UPLOADED',
      'VIDEO_UPDATED',
      'VIDEO_DELETED',
      'VIDEO_VIEWED',
      'VIDEO_CLASS_SUBJECT_MISMATCH',

      // Q&A
      'QUESTION_ASKED',
      'QUESTION_ANSWERED',

      // Automation
      'AUTOMATION_CREATED',
      'AUTOMATION_UPDATED',
      'AUTOMATION_DELETED',
      'AUTOMATION_TRIGGERED',

      // Leave
      'LEAVE_APPLIED',
      'LEAVE_APPROVED',
      'LEAVE_REJECTED',

      // Hostel / Transport
      'HOSTEL_ASSIGNED',
      'TRANSPORT_ASSIGNED',
      'ROOM_CREATED',
      'ROOM_UPDATED',

      // Bill
      'BILL_CREATED',
      'BILL_PAID',
      'BILL_CANCELLED',

      // Subscription billing (enterprise)
      'SUBSCRIPTION_RENEWED',
      'SUBSCRIPTION_SUSPENDED',
      'SUBSCRIPTION_REACTIVATED',
      'PAYMENT_RETRY_SCHEDULED',
      'PLAN_UPGRADED',
      'PLAN_DOWNGRADED',

// Error logs
      'ERROR_OCCURRED',
      'VALIDATION_FAILED',
      'UNAUTHORIZED_ACCESS',
      'SERVER_ERROR',

      // ====== ENTERPRISE AUDIT EVENTS ======
      // Super Admin - Authentication (Extended)
      'LOGIN_FAILED',
      'LOGOUT_INITIATED',
      'SESSION_EXPIRED',

      // Super Admin - School Management (Extended)
      'SCHOOL_DELETED',
      'SCHOOL_SUSPENDED',
      'SCHOOL_REACTIVATED',
      'SUBSCRIPTION_CHANGED',
      'SUBSCRIPTION_PLAN_CHANGED',
      'SETTINGS_UPDATED',

      // Super Admin - User Management (Extended)
      'USER_ACCESS_REVOKED',
      'USER_RESTORED',
      'USER_PASSWORD_CHANGED',

      // School Admin - Teacher Management
      'TEACHER_DELETED',
      'TEACHER_ASSIGNED',
      'TEACHER_REMOVED',

      // School Admin - Student Management
      'STUDENT_DELETED',
      'STUDENT_PROMOTED',
      'STUDENT_TRANSFERRED',
      'STUDENT_REINSTATED',

      // School Admin - Class Management
      'CLASS_DELETED',

      // School Admin - Section Management
      'SECTION_CREATED',
      'SECTION_UPDATED',
      'SECTION_DELETED',

      // Academics - Attendance (Extended)
      'ATTENDANCE_MARKED',
      'ATTENDANCE_UPDATED',
      'ATTENDANCE_BULK_MARKED',

      // Academics - Marks
      'MARKS_ADDED',
      'MARKS_EDITED',
      'MARKS_UPDATED',

      // Academics - Results
      'RESULT_GENERATED',
      'RESULT_PUBLISHED',
      'RESULT_UPDATED',

      // Academics - Exams (Extended)
      'EXAM_DELETED',

      // Finance - Fees
      'FEE_COLLECTED',
      'FEE_UPDATED',
      'FEE_WAIVED',
      'FEE_REFUNDED',
      'FEE_DISCOUNT_APPLIED',

      // Finance - Expenses
      'EXPENSE_DELETED',
      'EXPENSE_APPROVED',
      'EXPENSE_REJECTED',

      // HR - Employees
      'EMPLOYEE_CREATED',
      'EMPLOYEE_UPDATED',
      'EMPLOYEE_DELETED',

      // HR - Salary
      'SALARY_GENERATED',
      'SALARY_PAID',
      'SALARY_DISBURSED',

      // Security - Account
      'ACCOUNT_LOCKED',
      'ACCOUNT_UNLOCKED',
      'PERMISSION_CHANGED',
      'API_ABUSE_DETECTED',
      'SECURITY_ALERT',
      'SUSPICIOUS_ACTIVITY',

      // System - Sessions
      'SESSION_CREATED',
      'SESSION_TERMINATED',
      'MULTI_LOGIN_DETECTED'
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
      'SYSTEM',
      'RATE_LIMIT',
      'INVENTORY',
      'ANNOUNCEMENT',
      'WORKFLOW',
      'NOTIFICATION',
      'FEE_ASSIGNMENT',
      'ADMISSION',
      'HOMEWORK',
      'PTM',
      'NOTICE',
      'VIDEO',
      'QUESTION',
      'AUTOMATION',
      'LEAVE',
      'HOSTEL',
      'TRANSPORT',
      'BILL',
      'TC',
      'PROMOTION',
      'SEATING',
      'QUESTION_PAPER',
      'ERROR',
      'LOGIN_SESSION',
      'ATTENDANCE_DAILY',
      'ATTENDANCE_SUBJECT',
      'BILLING'
    ]
  },
entityId: {
    type: mongoose.Schema.Types.ObjectId,
    required: false // Some actions might not have a specific entity
  },
  entityName: {
    type: String,
    required: false
  },
  userName: {
    type: String,
    required: false
  },
  schoolName: {
    type: String,
    required: false
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  details: {
    type: Object,
    default: {}
  },
  severity: {
    type: String,
    enum: ['INFO', 'WARNING', 'ERROR', 'CRITICAL'],
    default: 'INFO',
    index: true
  },
  category: {
    type: String,
    enum: ['Security', 'Auth', 'Database', 'API', 'Firewall', 'Backup', 'Compliance', 'System'],
    default: 'System'
  },
  requestId: {
    type: String,
    index: true
  },
  traceId: {
    type: String
  },
  endpoint: {
    type: String
  },
  method: {
    type: String
  },
  statusCode: {
    type: Number
  },
  latencyMs: {
    type: Number
  },
  responseSize: {
    type: Number
  },
  payloadSize: {
    type: Number
  },
  region: {
    type: String,
    default: 'MUM'
  },
  browser: {
    type: String
  },
  os: {
    type: String
  },
  device: {
    type: String
  },
  deviceId: {
    type: String
  },
  fingerprint: {
    type: String
  },
  riskScore: {
    type: Number,
    min: 0,
    max: 1,
    default: 0
  },
  aiThreatScore: {
    type: Number,
    min: 0,
    max: 1,
    default: 0
  },
  anomalyScore: {
    type: Number,
    min: 0,
    max: 1,
    default: 0
  },
  isSuspicious: {
    type: Boolean,
    default: false
  },
  isBlocked: {
    type: Boolean,
    default: false
  },
  environment: {
    type: String,
    enum: ['PROD', 'STAGING', 'DEV'],
    default: 'PROD'
  },
  serverNode: {
    type: String
  },
  sourceService: {
    type: String
  },
  tags: [{
    type: String
  }],
  message: {
    type: String
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
AuditLogSchema.index({ schoolId: 1, severity: 1, createdAt: -1 });
AuditLogSchema.index({ schoolId: 1, action: 1, createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });
AuditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
AuditLogSchema.index({ createdAt: -1 }); // For date range queries
AuditLogSchema.index({ severity: 1, createdAt: -1 });
AuditLogSchema.index({ category: 1, createdAt: -1 });
AuditLogSchema.index({ riskScore: -1 });
AuditLogSchema.index({ ipAddress: 1, createdAt: -1 });
AuditLogSchema.index({ requestId: 1 }, { unique: true, sparse: true });
AuditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 });

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
