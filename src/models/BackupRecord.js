const mongoose = require('mongoose');

const BackupRecordSchema = new mongoose.Schema({
  schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', index: true },
  status: { type: String, enum: ['PENDING', 'RUNNING', 'SUCCESS', 'FAILED'], default: 'PENDING', index: true },
  sizeBytes: { type: Number, default: 0 },
  storagePath: { type: String },
  checksum: { type: String },
  startedAt: { type: Date, default: Date.now },
  completedAt: { type: Date },
  error: { type: String },
  initiatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

BackupRecordSchema.index({ createdAt: -1 });

module.exports = mongoose.model('BackupRecord', BackupRecordSchema);
