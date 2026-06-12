const mongoose = require('mongoose');
const { SCHOOL_STATUS, SAAS_PLANS } = require('../config/constants.js');

const schoolSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'School name is required'],
    trim: true
  },
  code: {
    type: String,
    required: [true, 'School code is required'],
    unique: true,
    uppercase: true,
    trim: true
  },
  plan: {
    type: String,
    enum: Object.values(SAAS_PLANS),
    default: SAAS_PLANS.BASIC
  },
  status: {
    type: String,
    enum: Object.values(SCHOOL_STATUS),
    default: SCHOOL_STATUS.ACTIVE
  },
  address: {
    type: String,
    trim: true
  },
  city: {
    type: String,
    trim: true,
    default: null
  },
  state: {
    type: String,
    trim: true,
    default: null
  },
  pincode: {
    type: String,
    trim: true,
    default: null
  },
  board: {
    type: String,
    trim: true,
    default: 'CBSE'
  },
  affiliation: {
    type: String,
    trim: true,
    default: null
  },
  website: {
    type: String,
    trim: true,
    default: null
  },
  timezone: {
    type: String,
    trim: true,
    default: 'Asia/Kolkata'
  },
  contact: {
    phone: String,
    email: String
  },
  limits: {
    studentLimit: {
      type: Number,
      default: 1000,
      min: 1
    },
    teacherLimit: {
      type: Number,
      default: 100,
      min: 1
    },
    storageLimit: {
      type: Number,
      default: 1073741824, // 1GB in bytes
      min: 1048576 // 1MB minimum
    }
  },
  subscription: {
    plan: {
      type: String,
      default: 'BASIC'
    },
    monthlyPrice: {
      type: Number,
      default: 499 // Default price in rupees
    },
    startDate: {
      type: Date,
      default: Date.now
    },
    endDate: {
      type: Date,
      default: () => new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // Default 1 year from now
    },
    status: {
      type: String,
      enum: ['TRIAL', 'ACTIVE', 'GRACE', 'EXPIRED', 'SUSPENDED'],
      default: 'ACTIVE'
    },
    isExpired: {
      type: Boolean,
      default: false
    },
    autoRenew: {
      type: Boolean,
      default: true
    },
    gracePeriodDays: {
      type: Number,
      default: 30 // 30 days grace period
    },
    lastRenewalDate: {
      type: Date,
      default: Date.now
    }
  },
  modules: {
    attendance: { type: Boolean, default: true },
    exams: { type: Boolean, default: true },
    fees: { type: Boolean, default: true },
    transport: { type: Boolean, default: false },
    hostel: { type: Boolean, default: false },
    academic_history: { type: Boolean, default: true },
    promotion: { type: Boolean, default: true },
    tc: { type: Boolean, default: true },
    homework: { type: Boolean, default: true },
    notices: { type: Boolean, default: true },
    videos: { type: Boolean, default: false },
    reports: { type: Boolean, default: true },
    salary: { type: Boolean, default: false },
    online_payments: { type: Boolean, default: false },
    classes: { type: Boolean, default: true },
    sections: { type: Boolean, default: true },
    subjects: { type: Boolean, default: true },
    schools: { type: Boolean, default: false },
    users: { type: Boolean, default: true },
    teachers: { type: Boolean, default: true },
    students: { type: Boolean, default: true },
    parents: { type: Boolean, default: true },
    dashboard: { type: Boolean, default: true },
    system: { type: Boolean, default: false },
    expenses: { type: Boolean, default: false }
  },
  analytics: {
    studentsCount: { type: Number, default: 0 },
    teachersCount: { type: Number, default: 0 },
    activeUsersToday: { type: Number, default: 0 },
    todayAttendancePct: { type: Number, default: 0 },
    todayFeeCollection: { type: Number, default: 0 },
    alertsCount: { type: Number, default: 0 },
    apiRequestsToday: { type: Number, default: 0 },
    storageUsedBytes: { type: Number, default: 0 },
    securityScore: { type: Number, default: 94 },
    cpuUsagePct: { type: Number, default: 0.4 },
    apiLatencyMs: { type: Number, default: 24 },
    onlineUsers: { type: Number, default: 0 },
    lastAnalyticsSync: { type: Date, default: null }
  },
  lastHeartbeat: {
    type: Date,
    default: null
  },
  healthScore: {
    type: Number,
    default: 100,
    min: 0,
    max: 100
  },
  riskLevel: {
    type: String,
    enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    default: 'LOW'
  },
  healthLastChecked: {
    type: Date,
    default: null
  },
  healthFactors: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  securitySettings: {
    failedLoginCount: { type: Number, default: 0 },
    lastFailedLogin: { type: Date, default: null },
    blockedUntil: { type: Date, default: null },
    mfaEnabled: { type: Boolean, default: false },
    allowedIpRanges: [{ type: String }],
    passwordPolicy: {
      minLength: { type: Number, default: 8 },
      requireUppercase: { type: Boolean, default: true },
      requireNumbers: { type: Boolean, default: true },
      expiryDays: { type: Number, default: 90 }
    }
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  deletedAt: {
    type: Date,
    default: null
  },
  isDeleted: {
    type: Boolean,
    default: false,
    index: true
  },
  onlinePaymentsEnabled: {
    type: Boolean,
    default: true // Default to enabled, but will be controlled by plan and admin toggle
  },
  forceLogoutAt: {
    type: Date,
    default: null // Timestamp when force logout was triggered
  }
}, {
  timestamps: true
});

schoolSchema.index({ isDeleted: 1, status: 1, 'subscription.endDate': 1 });
schoolSchema.index({ plan: 1, healthScore: -1 });
schoolSchema.index({ riskLevel: 1 });
schoolSchema.index({ 'analytics.lastAnalyticsSync': -1 });
schoolSchema.index({ 'subscription.endDate': 1, isDeleted: 1 });
schoolSchema.index({ isDeleted: 1, 'analytics.studentsCount': -1 });
schoolSchema.index({ isDeleted: 1, 'analytics.todayFeeCollection': -1 });
schoolSchema.index({ isDeleted: 1, healthScore: -1 });
schoolSchema.index({ status: 1, isDeleted: 1 });
schoolSchema.index({ code: 1 }, { unique: true });

const School = mongoose.model('School', schoolSchema);

module.exports = School;
