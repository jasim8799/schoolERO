const mongoose = require('mongoose');

const SchoolHealthSnapshotSchema = new mongoose.Schema({
  schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },
  date: { type: Date, required: true },
  healthScore: { type: Number, min: 0, max: 100 },
  riskLevel: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
  factors: {
    subscriptionHealth: { type: Number },
    feeCollection: { type: Number },
    attendanceHealth: { type: Number },
    storageHealth: { type: Number },
    securityHealth: { type: Number },
    activityHealth: { type: Number },
    moduleUsage: { type: Number }
  },
  studentsCount: { type: Number, default: 0 },
  teachersCount: { type: Number, default: 0 },
  attendancePct: { type: Number, default: 0 },
  feeCollection: { type: Number, default: 0 },
  aiPrediction: {
    churnRisk: { type: Number, min: 0, max: 1 },
    renewalProb: { type: Number, min: 0, max: 1 },
    recommendation: { type: String }
  }
}, { timestamps: true });

SchoolHealthSnapshotSchema.index({ schoolId: 1, date: -1 }, { unique: true });
SchoolHealthSnapshotSchema.index({ date: 1 }, { expireAfterSeconds: 31536000 });

module.exports = mongoose.model('SchoolHealthSnapshot', SchoolHealthSnapshotSchema);
