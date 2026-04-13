const mongoose = require('mongoose');

const leaveApplicationSchema = new mongoose.Schema(
  {
    applicantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    applicantRole: {
      type: String,
      enum: ['STUDENT', 'TEACHER', 'OPERATOR'],
      required: true,
    },
    // Only for students - links to Student record
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
    },
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AcademicSession',
      required: true,
    },
    fromDate: { type: Date, required: true },
    toDate: { type: Date, required: true },
    reason: { type: String, required: true },
    leaveType: {
      type: String,
      enum: ['SICK_LEAVE', 'CASUAL_LEAVE', 'EMERGENCY', 'OTHER'],
      default: 'CASUAL_LEAVE',
    },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING',
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewNote: { type: String },
    reviewedAt: { type: Date },
    // Auto-mark attendance flag
    attendanceMarked: { type: Boolean, default: false },
  },
  { timestamps: true }
);

leaveApplicationSchema.index({ applicantId: 1, schoolId: 1, status: 1 });
leaveApplicationSchema.index({ schoolId: 1, status: 1, fromDate: -1 });

module.exports = mongoose.model('LeaveApplication', leaveApplicationSchema);
