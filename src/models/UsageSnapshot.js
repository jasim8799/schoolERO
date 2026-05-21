const { Schema, model } = require('mongoose');

const UsageSnapshotSchema = new Schema({
  schoolId:       { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
  date:           { type: Date, required: true },   // midnight UTC
  activeUsers:    { type: Number, default: 0 },
  teacherCount:   { type: Number, default: 0 },
  studentCount:   { type: Number, default: 0 },
  apiRequests:    { type: Number, default: 0 },
  aiRequests:     { type: Number, default: 0 },
  storageUsedGB:  { type: Number, default: 0 },
  bandwidthGB:    { type: Number, default: 0 },
  loginCount:     { type: Number, default: 0 },
  concurrentPeak: { type: Number, default: 0 },
  billingHealth:  { type: Number, min: 0, max: 1, default: 0.9 },
  threatScore:    { type: Number, min: 0, max: 1, default: 0 },
}, { timestamps: true });

UsageSnapshotSchema.index({ schoolId: 1, date: -1 });
// TTL: keep 1 year of daily snapshots
UsageSnapshotSchema.index({ date: 1 }, { expireAfterSeconds: 31536000 });

module.exports = model('UsageSnapshot', UsageSnapshotSchema);
