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
    enum: ['Completed', 'Promoted', 'Retained', 'Left'],
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

module.exports = mongoose.model('AcademicHistory', AcademicHistorySchema);
