const { Schema, model } = require('mongoose');

const FraudAlertSchema = new Schema({
  schoolId:   { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
  alertType:  {
    type: String,
    enum: [
      'FAILED_PAYMENT_SPIKE', 'BRUTE_FORCE', 'API_ABUSE', 'RAPID_PLAN_SWITCH',
      'GEO_ANOMALY', 'CONCURRENT_SESSION', 'CHURN_RISK', 'SUSPICIOUS_RENEWAL',
    ],
    index: true,
  },
  severity:    { type: String, enum: ['LOW','MEDIUM','HIGH','CRITICAL'], default: 'MEDIUM' },
  threatScore: { type: Number, min: 0, max: 1 },
  signals:     { type: Schema.Types.Mixed },   // Individual signal contributions
  description: { type: String },
  resolved:    { type: Boolean, default: false },
  resolvedAt:  { type: Date },
  resolvedBy:  { type: Schema.Types.ObjectId, ref: 'User' },
  autoBlocked: { type: Boolean, default: false },
  createdAt:   { type: Date, default: Date.now, index: true },
}, { timestamps: false });

FraudAlertSchema.index({ schoolId: 1, severity: 1, resolved: 1 });
// TTL: auto-delete resolved alerts after 30 days
FraudAlertSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 });

module.exports = model('FraudAlert', FraudAlertSchema);
