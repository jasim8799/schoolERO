const mongoose = require('mongoose');

const { Schema } = mongoose;

const AIInsightSchema = new Schema(
  {
    reportId: { type: String, index: true },
    tenantId: { type: String, index: true },
    schoolId: { type: Schema.Types.ObjectId, ref: 'School' },
    title: { type: String, required: true },
    severity: { type: String, enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'], index: true },
    recommendation: { type: String },
    confidence: { type: Number, min: 0, max: 1 },
    anomalyType: { type: String },
    dataPoints: { type: Schema.Types.Mixed },
    createdAt: { type: Date, default: Date.now, index: true },
    resolved: { type: Boolean, default: false },
    color: { type: String },
  },
  { timestamps: false }
);

AIInsightSchema.index({ createdAt: 1 }, { expireAfterSeconds: 604800 });

module.exports = mongoose.model('AIInsight', AIInsightSchema);
