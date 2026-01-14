const mongoose = require('mongoose');

const SalaryPaymentSchema = new mongoose.Schema({
  salaryCalculationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SalaryCalculation',
    required: true
  },
  staffId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  month: {
    type: String, // YYYY-MM
    required: true
  },
  amountPaid: {
    type: Number,
    required: true,
    min: 0
  },
  paymentMode: {
    type: String,
    enum: ['Cash', 'Bank'],
    required: true
  },
  paymentDate: {
    type: Date,
    default: Date.now
  },
  paidBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
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

// Ensure one payment per salary calculation
SalaryPaymentSchema.index({ salaryCalculationId: 1 }, { unique: true });

// Index for efficient queries
SalaryPaymentSchema.index({ staffId: 1, month: 1, schoolId: 1 });

module.exports = mongoose.model('SalaryPayment', SalaryPaymentSchema);
