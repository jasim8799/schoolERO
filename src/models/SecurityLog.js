const mongoose = require('mongoose');

const SecurityLogSchema = new mongoose.Schema({
  schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  eventType: {
    type: String,
    enum: [
      'LOGIN_SUCCESS',
      'LOGIN_FAILED',
      'LOGOUT',
      'FORCE_LOGOUT',
      'TOKEN_REFRESH',
      'TOKEN_REVOKED',
      'PASSWORD_CHANGED',
      'SUSPICIOUS_LOGIN',
      'BRUTE_FORCE_DETECTED',
      'IP_BLOCKED',
      'PRIVILEGE_ESCALATION',
      'PERMISSION_DENIED',
      'ACCOUNT_LOCKED',
      'DEVICE_NEW',
      'GEO_ANOMALY'
    ],
    index: true,
    required: true
  },
  severity: {
    type: String,
    enum: ['INFO', 'WARNING', 'ERROR', 'CRITICAL'],
    default: 'INFO'
  },
  ipAddress: { type: String, index: true },
  userAgent: { type: String },
  deviceHash: { type: String },
  geoCountry: { type: String },
  geoCity: { type: String },
  geoLat: { type: Number },
  geoLon: { type: Number },
  isVPN: { type: Boolean, default: false },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
  resolved: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now, index: true }
}, { timestamps: false });

SecurityLogSchema.index({ schoolId: 1, createdAt: -1 });
SecurityLogSchema.index({ eventType: 1, severity: 1 });
SecurityLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 });

module.exports = mongoose.model('SecurityLog', SecurityLogSchema);
