// models/LoginAttemptLog.js
// Permanent immutable log of every login attempt.
// Used for SOC dashboard, security analytics, and forensics.
// Never deleted — super admin can query this for any account.

const mongoose = require('mongoose');

const loginAttemptLogSchema = new mongoose.Schema({
  // Target account info
  userId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  email:         { type: String, default: null },
  mobile:        { type: String, default: null },
  role:          { type: String, default: null },
  schoolId:      { type: mongoose.Schema.Types.ObjectId, ref: 'School', default: null },

  // Attempt result
  result: {
    type: String,
    enum: ['SUCCESS', 'WRONG_PASSWORD', 'USER_NOT_FOUND', 'ACCOUNT_LOCKED',
           'ACCOUNT_INACTIVE', 'SCHOOL_INACTIVE', 'CAPTCHA_REQUIRED'],
    required: true,
  },
  lockoutTriggered: { type: Boolean, default: false },
  lockoutLevel:     { type: Number, default: 0 },
  lockoutUntil:     { type: Date, default: null },
  captchaRequired:  { type: Boolean, default: false },

  // Request context
  ipAddress:   { type: String, default: null },
  userAgent:   { type: String, default: null },
  browser:     { type: String, default: null },
  os:          { type: String, default: null },
  deviceType:  { type: String, default: null },

  // Geo (derived from IP if available)
  geoCountry: { type: String, default: null },
  geoCity:    { type: String, default: null },
  isVPN:      { type: Boolean, default: false },

  // IP intelligence
  ipAttemptCount:    { type: Number, default: 0 },
  ipAccountsTargeted: { type: Number, default: 0 },
  ipIsSuspicious:    { type: Boolean, default: false },
}, {
  timestamps: true,
  collection: 'login_attempt_logs',
});

loginAttemptLogSchema.index({ userId: 1, createdAt: -1 });
loginAttemptLogSchema.index({ ipAddress: 1, createdAt: -1 });
loginAttemptLogSchema.index({ result: 1, createdAt: -1 });
loginAttemptLogSchema.index({ schoolId: 1, createdAt: -1 });
loginAttemptLogSchema.index({ createdAt: -1 });
loginAttemptLogSchema.index({ ipAddress: 1, result: 1, createdAt: -1 });

module.exports = mongoose.model('LoginAttemptLog', loginAttemptLogSchema);
