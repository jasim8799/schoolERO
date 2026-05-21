const mongoose = require('mongoose');

const SchoolAnalyticsDailySchema = new mongoose.Schema({
  schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },
  date: { type: Date, required: true, index: true },
  studentsCount: { type: Number, default: 0 },
  teachersCount: { type: Number, default: 0 },
  activeUsersToday: { type: Number, default: 0 },
  attendancePct: { type: Number, default: 0 },
  feeCollection: { type: Number, default: 0 },
  alertsCount: { type: Number, default: 0 },
  apiRequestsToday: { type: Number, default: 0 },
  storageUsedBytes: { type: Number, default: 0 },
  securityScore: { type: Number, default: 94 },
  onlineUsers: { type: Number, default: 0 }
}, { timestamps: true });

SchoolAnalyticsDailySchema.index({ schoolId: 1, date: -1 }, { unique: true });
SchoolAnalyticsDailySchema.index({ date: 1 }, { expireAfterSeconds: 31536000 });

module.exports = mongoose.model('SchoolAnalyticsDaily', SchoolAnalyticsDailySchema);
