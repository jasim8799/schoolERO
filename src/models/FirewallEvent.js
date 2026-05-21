const { Schema, model } = require('mongoose');

const FirewallEventSchema = new Schema({
  eventId:      { type: String, unique: true, index: true },
  schoolId:     { type: Schema.Types.ObjectId, ref: 'School', index: true },
  ipAddress:    { type: String, required: true, index: true },
  action:       { type: String, enum: ['BLOCKED','ALLOWED','RATE_LIMITED','FLAGGED'], default: 'BLOCKED' },
  reason:       { type: String },
  requestPath:  { type: String },
  method:       { type: String },
  userAgent:    { type: String },
  geoCountry:   { type: String },
  riskScore:    { type: Number, min: 0, max: 1, default: 0 },
  ruleTriggered: { type: String },
  createdAt:    { type: Date, default: Date.now, index: true },
}, { timestamps: false });

FirewallEventSchema.index({ ipAddress: 1, createdAt: -1 });
FirewallEventSchema.index({ action: 1, createdAt: -1 });
// TTL: 30 days
FirewallEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 });

module.exports = model('FirewallEvent', FirewallEventSchema);
