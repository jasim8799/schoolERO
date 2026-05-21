const mongoose = require('mongoose');

const LoginSessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', index: true },
  sessionToken: { type: String, unique: true, sparse: true },
  refreshToken: { type: String },
  deviceHash: { type: String },
  deviceName: { type: String },
  ipAddress: { type: String },
  geoCountry: { type: String },
  geoCity: { type: String },
  userAgent: { type: String },
  isActive: { type: Boolean, default: true },
  loginAt: { type: Date, default: Date.now },
  lastActiveAt: { type: Date, default: Date.now },
  expiresAt: { type: Date },
  logoutAt: { type: Date },
  forceLoggedOut: { type: Boolean, default: false }
}, { timestamps: true });

LoginSessionSchema.index({ userId: 1, isActive: 1 });
LoginSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('LoginSession', LoginSessionSchema);
