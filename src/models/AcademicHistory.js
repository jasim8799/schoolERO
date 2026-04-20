const mongoose = require('mongoose');

const AcademicHistorySchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  sessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AcademicSession',
    required: true
  },
  fromSessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AcademicSession'
  },
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    required: true
  },
  sectionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Section'
  },
  rollNumber: {
    type: String
  },
  resultSummary: {
    type: Object
  },
  attendanceSummary: {
    type: Object
  },
  status: {
    type: String,
    enum: ['Completed', 'Promoted', 'Retained', 'Left', 'Graduated'],
    required: true
  },
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    required: true
  }
}, {
  timestamps: true
});

AcademicHistorySchema.index({ studentId: 1, sessionId: 1, schoolId: 1 }, { unique: true });
AcademicHistorySchema.index({ schoolId: 1, fromSessionId: 1 });

module.exports = mongoose.model('AcademicHistory', AcademicHistorySchema);
