const mongoose = require('mongoose');

const FeePaymentSchema = new mongoose.Schema({
  studentFeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StudentFee',
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  mode: {
    type: String,
    enum: ['Cash', 'Bank', 'Online'],
    required: true
  },
  date: {
    type: Date,
    required: true,
    default: Date.now
  },
  collectedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  receiptNo: {
    type: String,
    required: true,
    unique: true
  },
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    required: true
  }
}, {
  timestamps: true
});

// Index for efficient queries
FeePaymentSchema.index({ studentFeeId: 1, schoolId: 1 });

module.exports = mongoose.model('FeePayment', FeePaymentSchema);
