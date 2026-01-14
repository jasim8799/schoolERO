const mongoose = require('mongoose');

const AdmitCardSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  examId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Exam',
    required: true
  },
  rollNumber: {
    type: String,
    required: true
  },
  examCenter: {
    type: String
  },
  generatedAt: {
    type: Date,
    default: Date.now
  },
  sessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AcademicSession',
    required: true
  },
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    required: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

AdmitCardSchema.index({ studentId: 1, examId: 1, sessionId: 1, schoolId: 1 }, { unique: true });

module.exports = mongoose.model('AdmitCard', AdmitCardSchema);
