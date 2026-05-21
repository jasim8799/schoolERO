const mongoose = require('mongoose');

const { Schema } = mongoose;

const ExportHistorySchema = new Schema(
  {
    reportId: { type: String, required: true, index: true },
    tenantId: { type: String, index: true },
    exportedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    exportedAt: { type: Date, default: Date.now },
    exportType: { type: String, enum: ['PDF', 'XLSX', 'CSV', 'JSON'] },
    destination: { type: String, enum: ['DOWNLOAD', 'EMAIL', 'WEBHOOK', 'S3', 'API'] },
    fileUrl: { type: String },
    sizeBytes: { type: Number },
    deliveryStatus: {
      type: String,
      enum: ['PENDING', 'DELIVERED', 'FAILED', 'RETRYING'],
      default: 'PENDING',
    },
    webhookStatus: { type: Number },
    retries: { type: Number, default: 0 },
    deliveredAt: { type: Date },
    failedReason: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ExportHistory', ExportHistorySchema);
