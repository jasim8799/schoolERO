// models/SecurityAnalytics.js
// Permanent daily security analytics — never deleted, never expires.
// One document per UTC day. Updated atomically via $inc.

const mongoose = require('mongoose');

const securityAnalyticsSchema = new mongoose.Schema({
  // Date key: 'YYYY-MM-DD' in UTC — one document per day
  date: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  // Permanent counters — increment only, never reset
  totalFailedLogins: { type: Number, default: 0 },
  totalBlockedIps: { type: Number, default: 0 },
  totalThreats: { type: Number, default: 0 },
  totalMalwareAttempts: { type: Number, default: 0 },
  totalFirewallBlocks: { type: Number, default: 0 },
  totalSuspiciousIps: { type: Number, default: 0 },
  totalGeoAnomalies: { type: Number, default: 0 },
  totalAiDetections: { type: Number, default: 0 },
  totalSecurityEvents: { type: Number, default: 0 },
  totalRateLimitHits: { type: Number, default: 0 },
  totalBruteForce: { type: Number, default: 0 },
  totalSessionHijack: { type: Number, default: 0 },
  // Peak tracking
  peakFailedLoginsHour: { type: Number, default: 0 },
  peakThreatLevel: { type: String, default: 'LOW' },
  // Unique IPs set (stored as array — MongoDB handles uniqueness via $addToSet)
  uniqueThreatIps: [{ type: String }],
  // Schools affected (schoolIds as strings)
  schoolsAffected: [{ type: String }],
  // Top attack sources for geo tracking
  attackSources: [{
    country: { type: String },
    city: { type: String },
    ip: { type: String },
    count: { type: Number, default: 1 },
  }],
}, {
  timestamps: true,
  // Prevent Mongoose from pluralizing — use exact collection name
  collection: 'security_analytics',
});

// Indexes for efficient date-range queries
securityAnalyticsSchema.index({ date: -1 });
securityAnalyticsSchema.index({ createdAt: -1 });

module.exports = mongoose.model('SecurityAnalytics', securityAnalyticsSchema);
