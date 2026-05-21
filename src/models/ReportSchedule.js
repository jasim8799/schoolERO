const mongoose = require('mongoose');

const { Schema } = mongoose;

const ReportScheduleSchema = new Schema(
  {
    scheduleId: { type: String, required: true, unique: true },
    tenantId: { type: String, required: true, index: true },
    schoolId: { type: Schema.Types.ObjectId, ref: 'School' },
    reportCategory: { type: String },
    exportType: { type: String, default: 'PDF' },
    cronExpression: { type: String, required: true },
    timezone: { type: String, default: 'Asia/Kolkata' },
    nextRun: { type: Date, index: true },
    lastRun: { type: Date },
    enabled: { type: Boolean, default: true },
    recipients: [{ type: String }],
    webhookUrl: { type: String },
    retryPolicy: {
      maxRetries: Number,
      backoffMs: Number,
    },
    filters: { type: Schema.Types.Mixed },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ReportSchedule', ReportScheduleSchema);
