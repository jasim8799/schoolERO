const mongoose = require('mongoose');

const { Schema } = mongoose;

const QueryLogSchema = new Schema(
  {
    reportId: { type: String, index: true },
    tenantId: { type: String, index: true },
    query: { type: String },
    runtimeMs: { type: Number },
    cacheHit: { type: Boolean, default: false },
    rowsReturned: { type: Number },
    optimizationApplied: { type: Boolean, default: false },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

QueryLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 604800 });

module.exports = mongoose.model('QueryLog', QueryLogSchema);
