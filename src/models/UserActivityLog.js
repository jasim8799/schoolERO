const { Schema, model } = require('mongoose');

const UserActivityLogSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  schoolId: { type: Schema.Types.ObjectId, ref: 'School', index: true },
  action: { type: String, required: true, index: true },
  category: { type: String, enum: ['AUTH', 'DATA', 'ADMIN', 'SECURITY', 'API'], default: 'DATA' },
  description: { type: String },
  ipAddress: { type: String },
  deviceHash: { type: String },
  userAgent: { type: String },
  metadata: { type: Schema.Types.Mixed },
  riskLevel: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH'], default: 'LOW' },
  createdAt: { type: Date, default: Date.now, index: true },
}, { timestamps: false });

UserActivityLogSchema.index({ userId: 1, createdAt: -1 });
UserActivityLogSchema.index({ userId: 1, category: 1 });
UserActivityLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 });

module.exports = model('UserActivityLog', UserActivityLogSchema);
