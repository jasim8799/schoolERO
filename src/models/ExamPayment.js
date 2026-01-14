const mongoose = require('mongoose');

const ExamPaymentSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  examFormId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ExamForm',
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  paymentMode: {
    type: String,
    enum: ['Online', 'Manual'],
    required: true
  },
  status: {
    type: String,
    enum: ['Pending', 'Paid'],
    default: 'Pending'
  },
  receiptNumber: {
    type: String
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

ExamPaymentSchema.index({ studentId: 1, examFormId: 1, sessionId: 1, schoolId: 1 }, { unique: true });

module.exports = mongoose.model('ExamPayment', ExamPaymentSchema);
