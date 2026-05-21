const mongoose = require('mongoose');

const { Schema } = mongoose;

const ReportJobSchema = new Schema(
  {
    jobId: { type: String, required: true, unique: true, index: true },
    reportId: { type: String, required: true, index: true },
    tenantId: { type: String },
    queueStatus: {
      type: String,
      enum: ['waiting', 'active', 'completed', 'failed', 'delayed', 'paused'],
      default: 'waiting',
    },
    workerId: { type: String },
    retries: { type: Number, default: 0 },
    maxRetries: { type: Number, default: 3 },
    progress: { type: Number, default: 0 },
    startedAt: { type: Date },
    finishedAt: { type: Date },
    memoryUsageMB: { type: Number },
    cpuPct: { type: Number },
    failedReason: { type: String },
    logs: [
      {
        timestamp: { type: Date, default: Date.now },
        level: { type: String, enum: ['INFO', 'WARN', 'ERROR'] },
        message: { type: String },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model('ReportJob', ReportJobSchema);
