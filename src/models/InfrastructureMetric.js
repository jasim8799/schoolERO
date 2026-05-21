const mongoose = require('mongoose');

const { Schema } = mongoose;

const InfrastructureMetricSchema = new Schema(
  {
    timestamp: { type: Date, default: Date.now, index: true },
    tenantId: { type: String },
    ramUsagePct: { type: Number, default: 0 },
    dbConnectionsActive: { type: Number, default: 0 },
    dbLatencyMs: { type: Number, default: 0 },
    apiLatencyMs: { type: Number, default: 0 },
    requestsPerMin: { type: Number, default: 0 },
    errorRate: { type: Number, default: 0 },
    activeSchools: { type: Number, default: 0 },
    onlineUsers: { type: Number, default: 0 },
    queueJobsPending: { type: Number, default: 0 },
    backupStatus: {
      type: String,
      enum: ['OK', 'RUNNING', 'FAILED', 'PENDING'],
      default: 'PENDING'
    },
    queueDepth: { type: Number, default: 0 },
    workerCount: { type: Number, default: 0 },
    activeWorkers: { type: Number, default: 0 },
    exportSpeedMBps: { type: Number, default: 0 },
    memoryUsagePct: { type: Number, default: 0 },
    cpuUsagePct: { type: Number, default: 0 },
    failedJobsCount: { type: Number, default: 0 },
    avgQueryMs: { type: Number, default: 0 },
    cacheHitRate: { type: Number, default: 0 },
    reportsGenerated24h: { type: Number, default: 0 },
    storageUsedGB: { type: Number, default: 0 },
  },
  { timestamps: false }
);

InfrastructureMetricSchema.index({ timestamp: 1 }, { expireAfterSeconds: 2592000 });

module.exports = mongoose.model('InfrastructureMetric', InfrastructureMetricSchema);
