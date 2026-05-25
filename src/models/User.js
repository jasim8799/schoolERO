const mongoose = require('mongoose');
const { USER_ROLES, USER_STATUS } = require('../config/constants');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true
  },
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  mobile: {
    type: String,
    trim: true
  },
  whatsappNumber: {
    type: String,
    trim: true
  },
  photoUrl: {
    type: String,
    default: null
  },
  // Personal details
  gender: {
    type: String,
    enum: ['Male', 'Female', 'Other'],
    default: null
  },
  dateOfBirth: {
    type: Date,
    default: null
  },
  bloodGroup: {
    type: String,
    default: null
  },
  address: {
    type: String,
    trim: true,
    default: null
  },
  occupation: {
    type: String,
    trim: true,
    default: null
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

  // Professional details
  employeeId: {
    type: String,
    trim: true,
    default: null
  },
  designation: {
    type: String,
    trim: true,
    default: null
  },
  department: {
    type: String,
    trim: true,
    default: null
  },
  dateOfJoining: {
    type: Date,
    default: null
  },
  qualification: {
    type: String,
    trim: true,
    default: null
  },
  experienceYears: {
    type: Number,
    default: 0
  },
  previousSchool: {
    type: String,
    trim: true,
    default: null
  },
  subjects: {
    type: [String],
    default: []
  },

  // Salary / bank details
  monthlySalary: {
    type: Number,
    default: 0
  },
  accountNumber: {
    type: String,
    trim: true,
    default: null
  },
  bankName: {
    type: String,
    trim: true,
    default: null
  },
  ifscCode: {
    type: String,
    trim: true,
    default: null
  },
  upiId: {
    type: String,
    trim: true,
    default: null
  },

  // Emergency / family
  emergencyContactName: {
    type: String,
    trim: true,
    default: null
  },
  emergencyContactRelation: {
    type: String,
    trim: true,
    default: null
  },
  emergencyContactPhone: {
    type: String,
    trim: true,
    default: null
  },
  spouseName: {
    type: String,
    trim: true,
    default: null
  },
  spouseMobile: {
    type: String,
    trim: true,
    default: null
  },

  // Documents (base64 dataUrls)
  documents: {
    aadhaarCard: {
      fileName: String,
      dataUrl: { type: String, select: false },
      uploadedAt: Date
    },
    panCard: {
      fileName: String,
      dataUrl: { type: String, select: false },
      uploadedAt: Date
    },
    degreeCertificate: {
      fileName: String,
      dataUrl: { type: String, select: false },
      uploadedAt: Date
    },
    experienceCertificate: {
      fileName: String,
      dataUrl: { type: String, select: false },
      uploadedAt: Date
    },
    staffPhoto: {
      fileName: String,
      dataUrl: { type: String, select: false },
      uploadedAt: Date
    }
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: 6,
    select: false  // Don't return password by default
  },
  role: {
    type: String,
    required: [true, 'Role is required'],
    enum: Object.values(USER_ROLES)
  },
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    required: function() {
      // schoolId is not required for SUPER_ADMIN
      return this.role !== USER_ROLES.SUPER_ADMIN;
    }
  },
  status: {
    type: String,
    enum: Object.values(USER_STATUS),
    default: USER_STATUS.ACTIVE
  },
  // Security intelligence
  mfaEnabled: {
    type: Boolean,
    default: false
  },
  mfaSecret: {
    type: String,
    select: false
  },
  encrypted: {
    type: Boolean,
    default: true
  },
  apiAccess: {
    type: Boolean,
    default: false
  },
  vpnDetected: {
    type: Boolean,
    default: false
  },
  lastKnownIp: {
    type: String,
    default: null
  },
  lastKnownDevice: {
    type: String,
    default: 'Unknown'
  },
  lastKnownLocation: {
    type: String,
    default: 'N/A'
  },
  // Threat intelligence
  threatScore: {
    type: Number,
    min: 0,
    max: 1,
    default: 0
  },
  riskLevel: {
    type: String,
    enum: ['LOW', 'MEDIUM', 'HIGH'],
    default: 'LOW'
  },
  threatLastChecked: {
    type: Date,
    default: null
  },
  // Session tracking
  activeSessions: {
    type: Number,
    default: 0
  },
  sessionTokens: {
    type: Number,
    default: 0
  },
  liveDevices: {
    type: Number,
    default: 0
  },
  // Login analytics
  successLogins: {
    type: Number,
    default: 0
  },
  failedLogins: {
    type: Number,
    default: 0
  },
  totalLogins: {
    type: Number,
    default: 0
  },
  lastFailedLogin: {
    type: Date,
    default: null
  },
  lockedUntil: {
    type: Date,
    default: null
  },
  // Account-level lockout (per account, NOT per IP)
  consecutiveFailedLogins: {
    type: Number,
    default: 0,
  },
  lockoutLevel: {
    // 0=none, 1=warn, 2=locked-15min, 3=locked-1hr, 4=locked-24hr
    type: Number,
    default: 0,
    min: 0,
    max: 4,
  },
  captchaRequired: {
    type: Boolean,
    default: false,
  },
  // Total lifetime failed login count (never resets)
  totalFailedLoginsAllTime: {
    type: Number,
    default: 0,
  },
  lastLogin: {
    type: Date,
    default: null,
    index: true
  },
  loginHistory: [{
    at: { type: Date, default: Date.now },
    ipAddress: { type: String },
    userAgent: { type: String },
    status: { type: String, enum: ['SUCCESS', 'FAILED'], default: 'SUCCESS' }
  }],
  deviceTracking: [{
    deviceHash: { type: String, required: true },
    userAgent: { type: String },
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    ipAddress: { type: String }
  }],
  deactivatedAt: {
    type: Date
  },
  deactivatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  // Soft delete
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: {
    type: Date,
    default: null
  },
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, {
  timestamps: true
});

// Compound index for email and mobile uniqueness
userSchema.index({ email: 1 }, { unique: true, sparse: true });
userSchema.index({ mobile: 1 }, { unique: true, sparse: true });
userSchema.index({ schoolId: 1, role: 1, status: 1 });
userSchema.index({ schoolId: 1, lastLogin: -1 });
userSchema.index({ isDeleted: 1, status: 1, role: 1 });
userSchema.index({ threatScore: -1 });
userSchema.index({ riskLevel: 1 });
userSchema.index({ mfaEnabled: 1, role: 1 });
userSchema.index({ schoolId: 1, role: 1, status: 1, isDeleted: 1 });
userSchema.index({ 'deviceTracking.deviceHash': 1 });
userSchema.index({ lastLogin: -1 });
// Account lockout indexes
userSchema.index({ lockedUntil: 1, consecutiveFailedLogins: 1 });
userSchema.index({ role: 1, lockedUntil: 1 });

// Ensure at least email or mobile is provided
userSchema.pre('save', function(next) {
  if (!this.email && !this.mobile) {
    next(new Error('Either email or mobile is required'));
  }
  next();
});

const User = mongoose.model('User', userSchema);

module.exports = User;
