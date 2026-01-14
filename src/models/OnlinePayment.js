const mongoose = require('mongoose');

const OnlinePaymentSchema = new mongoose.Schema({
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
  gatewayRef: {
    type: String,
    required: true,
    unique: true
  },
  status: {
    type: String,
    enum: ['Pending', 'Success', 'Failed'],
    default: 'Pending'
  },
  receiptNo: {
    type: String,
    sparse: true // Only set when payment succeeds
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
OnlinePaymentSchema.index({ studentFeeId: 1, schoolId: 1 });
OnlinePaymentSchema.index({ gatewayRef: 1 }, { unique: true });

module.exports = mongoose.model('OnlinePayment', OnlinePaymentSchema);
