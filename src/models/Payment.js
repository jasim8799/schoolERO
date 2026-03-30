const mongoose = require('mongoose');
const PaymentSchema = new mongoose.Schema({
  receiptNumber: {
    type: String,
    required: true,
    unique: true
  },
  billId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Bill',
    required: true
  },
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    required: true
  },
  sessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AcademicSession',
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0.01
  },
  paymentMode: {
    type: String,
    enum: ['Cash', 'Bank', 'Online', 'Cheque', 'DD'],
    required: true
  },
  paymentDate: {
    type: Date,
    default: Date.now
  },
  collectedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  notes: {
    type: String
  }
}, { timestamps: true });

PaymentSchema.index({ billId: 1 });
PaymentSchema.index({ studentId: 1, schoolId: 1 });
PaymentSchema.index({ receiptNumber: 1 }, { unique: true });
PaymentSchema.index({ paymentDate: -1, schoolId: 1 });

module.exports = mongoose.model('Payment', PaymentSchema);
