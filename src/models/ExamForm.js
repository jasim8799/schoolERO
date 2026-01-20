const mongoose = require('mongoose');

const ExamFormSchema = new mongoose.Schema({
  examId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Exam',
    required: true
  },
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    required: true
  },
  feeAmount: {
    type: Number,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  isPaymentRequired: {
    type: Boolean,
    default: true
  },
  status: {
    type: String,
    enum: ['ACTIVE', 'CLOSED'],
    default: 'ACTIVE'
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

ExamFormSchema.index({ examId: 1, classId: 1, sessionId: 1, schoolId: 1 }, { unique: true });

module.exports = mongoose.model('ExamForm', ExamFormSchema);
