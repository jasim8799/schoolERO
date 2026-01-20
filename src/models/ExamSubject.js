const mongoose = require('mongoose');

const ExamSubjectSchema = new mongoose.Schema({
  examId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Exam',
    required: true
  },
  subjectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subject',
    required: true
  },
  maxMarks: {
    type: Number,
    required: true
  },
  passMarks: {
    type: Number,
    required: true
  },
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
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
  }
}, {
  timestamps: true
});

ExamSubjectSchema.index({ examId: 1, subjectId: 1, sessionId: 1, schoolId: 1 }, { unique: true });

module.exports = mongoose.model('ExamSubject', ExamSubjectSchema);
