const mongoose = require('mongoose');

const SalaryProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  baseSalary: {
    type: Number,
    required: true,
    min: [0, 'Base salary cannot be negative']
  },
  salaryType: {
    type: String,
    enum: ['Monthly'],
    default: 'Monthly',
    required: true
  },
  allowances: [{
    name: {
      type: String,
      required: true,
      trim: true
    },
    amount: {
      type: Number,
      required: true,
      min: [0, 'Allowance amount cannot be negative']
    }
  }],
  deductions: [{
    name: {
      type: String,
      required: true,
      trim: true
    },
    amount: {
      type: Number,
      required: true,
      min: [0, 'Deduction amount cannot be negative']
    }
  }],
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    required: true
  }
}, {
  timestamps: true
});

// Ensure one salary profile per staff per school
SalaryProfileSchema.index({ userId: 1, schoolId: 1 }, { unique: true });

// Index for efficient queries
SalaryProfileSchema.index({ schoolId: 1 });

module.exports = mongoose.model('SalaryProfile', SalaryProfileSchema);
