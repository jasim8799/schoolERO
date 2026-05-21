const { Schema, model } = require('mongoose');

const RevenueGrowthHistorySchema = new Schema({
  weekStart:       { type: Date, required: true, unique: true },
  mrr:             { type: Number, default: 0 },
  arr:             { type: Number, default: 0 },
  newSchools:      { type: Number, default: 0 },
  churnedSchools:  { type: Number, default: 0 },
  netGrowthPct:    { type: Number, default: 0 },
  forecastNext:    { type: Number, default: 0 },
  confidence:      { type: Number, min: 0, max: 1, default: 0.75 },
}, { timestamps: true });

RevenueGrowthHistorySchema.index({ weekStart: -1 });
// TTL: keep 2 years
RevenueGrowthHistorySchema.index({ weekStart: 1 }, { expireAfterSeconds: 63072000 });

module.exports = model('RevenueGrowthHistory', RevenueGrowthHistorySchema);
