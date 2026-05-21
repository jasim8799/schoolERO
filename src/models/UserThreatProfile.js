const { Schema, model } = require('mongoose');

const UserThreatProfileSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  schoolId: { type: Schema.Types.ObjectId, ref: 'School', index: true },
  threatScore: { type: Number, min: 0, max: 1, default: 0 },
  riskLevel: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH'], default: 'LOW' },
  signals: {
    failedLogins: { count: Number, score: Number },
    unusualIpChanges: { count: Number, score: Number },
    multipleDevices: { count: Number, score: Number },
    rapidLoginAttempts: { count: Number, score: Number },
    securityEvents: { count: Number, score: Number },
    vpnUsage: { detected: Boolean, score: Number },
  },
  lastCalculatedAt: { type: Date, default: Date.now },
  autoFlagged: { type: Boolean, default: false },
  flagReason: { type: String },
}, { timestamps: true });

module.exports = model('UserThreatProfile', UserThreatProfileSchema);
