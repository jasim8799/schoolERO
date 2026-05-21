const mongoose = require('mongoose');

const { Schema } = mongoose;

const ReportSchema = new Schema(
  {
    reportId: { type: String, required: true, unique: true, index: true },
    tenantId: { type: String, required: true, index: true },
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', index: true },
    organizationId: { type: String, index: true },

    reportName: { type: String, required: true },
    category: {
      type: String,
      enum: [
        'Revenue Analytics',
        'Subscription Analytics',
        'Attendance Reports',
        'Student Performance Reports',
        'Security Reports',
        'Audit Reports',
        'Compliance Reports',
        'Infrastructure Reports',
        'User Activity Reports',
        'AI Intelligence Reports',
        'Fee Collection Reports',
        'Payroll Reports',
        'Exam Reports',
        'Admission Reports',
        'Transport Reports',
        'Inventory Reports',
        'Realtime Dashboards',
      ],
      index: true,
    },
    department: { type: String },
    reportType: {
      type: String,
      enum: ['STANDARD', 'AI_AUTO', 'SCHEDULED', 'LIVE', 'COMPLIANCE'],
      default: 'STANDARD',
    },
    mode: {
      type: String,
      enum: ['Manual', 'AI Auto', 'AI Assisted', 'Scheduled'],
      default: 'Manual',
    },

    status: {
      type: String,
      enum: ['READY', 'RUNNING', 'FAILED', 'SCHEDULED', 'QUEUED', 'LIVE', 'RETRYING', 'ARCHIVED', 'DEGRADED'],
      default: 'QUEUED',
      index: true,
    },
    progress: { type: Number, default: 0, min: 0, max: 100 },

    exportType: { type: String, enum: ['PDF', 'XLSX', 'CSV', 'JSON'], default: 'PDF' },
    fileUrl: { type: String },
    fileKey: { type: String },
    sizeBytes: { type: Number, default: 0 },
    compressionRatio: { type: Number, default: 0.62 },

    createdAt: { type: Date, default: Date.now, index: true },
    startedAt: { type: Date },
    completedAt: { type: Date },
    durationMs: { type: Number },
    expiresAt: { type: Date },

    aiScore: { type: Number, min: 0, max: 1, default: 0.85 },
    aiMetadata: { type: Schema.Types.Mixed },

    compliance: {
      gdpr: { type: Boolean, default: false },
      iso27001: { type: Boolean, default: false },
      soc2: { type: Boolean, default: false },
      piiDetected: { type: Boolean, default: false },
      encrypted: { type: Boolean, default: true },
      retentionDays: { type: Number, default: 90 },
    },

    queryInfo: {
      queryCount: { type: Number, default: 0 },
      avgRuntimeMs: { type: Number, default: 0 },
      cacheHitRate: { type: Number, default: 0 },
      rowsProcessed: { type: Number, default: 0 },
      optimizationApplied: { type: Boolean, default: false },
    },

    filters: { type: Schema.Types.Mixed },
    tags: [{ type: String }],
    metadata: { type: Schema.Types.Mixed },

    scheduleId: { type: Schema.Types.ObjectId, ref: 'ReportSchedule' },
    generatedBy: { type: String },
    generatedById: { type: Schema.Types.ObjectId, ref: 'User' },

    version: { type: Number, default: 1 },
    parentReportId: { type: String },
  },
  { timestamps: false }
);

ReportSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
ReportSchema.index({ tenantId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('Report', ReportSchema);
