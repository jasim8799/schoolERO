const { Schema, model } = require('mongoose');

const RevenueSnapshotSchema = new Schema({
  date:            { type: Date, required: true, unique: true },

  // Core SaaS metrics
  totalMRR:        { type: Number, default: 0 },
  totalARR:        { type: Number, default: 0 },
  grossProfit:     { type: Number, default: 0 },
  netProfit:       { type: Number, default: 0 },
  forecastMRR:     { type: Number, default: 0 },

  // Revenue breakdown
  newMRR:          { type: Number, default: 0 },
  churnedMRR:      { type: Number, default: 0 },
  expansionMRR:    { type: Number, default: 0 },
  contractionMRR:  { type: Number, default: 0 },

  // Transaction metrics
  totalTransactions:    { type: Number, default: 0 },
  successfulPayments:   { type: Number, default: 0 },
  failedPayments:       { type: Number, default: 0 },
  totalRefunds:         { type: Number, default: 0 },
  pendingInvoices:      { type: Number, default: 0 },

  // Financial health
  avgCashflow:          { type: Number, default: 0 },
  avgBillingHealth:     { type: Number, default: 0 },
  avgFraudScore:        { type: Number, default: 0 },
  paymentSuccessRate:   { type: Number, default: 0 },

  // Plan & gateway
  planBreakdown:        { type: Schema.Types.Mixed },
  gatewayBreakdown:     { type: Schema.Types.Mixed },

  // Tax
  gstCollected:         { type: Number, default: 0 },
  taxableRevenue:       { type: Number, default: 0 },

  activeSchools:        { type: Number, default: 0 },
  avgRevenuePerSchool:  { type: Number, default: 0 },
}, { timestamps: true });

RevenueSnapshotSchema.index({ date: -1 });
// TTL: keep 3 years
RevenueSnapshotSchema.index({ date: 1 }, { expireAfterSeconds: 94608000 });

module.exports = model('RevenueSnapshot', RevenueSnapshotSchema);
