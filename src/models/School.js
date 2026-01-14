import mongoose from 'mongoose';
import { SCHOOL_STATUS, SAAS_PLANS } from '../config/constants.js';

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
    endDate: {
      type: Date,
      default: () => new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // Default 1 year from now
    },
    isExpired: {
      type: Boolean,
      default: false
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
    exam: { type: Boolean, default: true },
    fees: { type: Boolean, default: true },
    transport: { type: Boolean, default: true },
    hostel: { type: Boolean, default: true },
    academic_history: { type: Boolean, default: true },
    promotion: { type: Boolean, default: true },
    tc: { type: Boolean, default: true },
    homework: { type: Boolean, default: true },
    notices: { type: Boolean, default: true },
    videos: { type: Boolean, default: true },
    reports: { type: Boolean, default: true },
    salary: { type: Boolean, default: true }
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

const School = mongoose.model('School', schoolSchema);

export default School;
