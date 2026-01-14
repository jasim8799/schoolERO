const mongoose = require('mongoose');

const SalaryCalculationSchema = new mongoose.Schema({
  staffId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  month: {
    type: String, // YYYY-MM
    required: true
  },
  baseSalary: {
    type: Number,
    required: true,
    min: 0
  },
  attendanceDays: {
    type: Number,
    required: true,
    min: 0
  },
  workingDays: {
    type: Number,
    required: true,
    min: 1
  },
  leaveDays: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  grossSalary: {
    type: Number,
    required: true,
    min: 0
  },
  deductions: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  netPayable: {
    type: Number,
    required: true,
    min: 0
  },
  status: {
    type: String,
    enum: ['Calculated', 'Paid'],
    default: 'Calculated',
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

// Ensure one calculation per staff per month per school
SalaryCalculationSchema.index({ staffId: 1, month: 1, schoolId: 1 }, { unique: true });

// Index for efficient queries
SalaryCalculationSchema.index({ schoolId: 1, month: 1 });

module.exports = mongoose.model('SalaryCalculation', SalaryCalculationSchema);
