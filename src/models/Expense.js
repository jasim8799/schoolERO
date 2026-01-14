const mongoose = require('mongoose');

const ExpenseSchema = new mongoose.Schema({
  category: {
    type: String,
    enum: ['Electricity', 'Salary', 'Repair', 'Hostel', 'Transport', 'Misc'],
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0.01
  },
  date: {
    type: Date,
    required: true,
    default: Date.now
  },
  paymentMode: {
    type: String,
    enum: ['Cash', 'Bank'],
    required: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  billAttachment: {
    type: String, // File path or URL
    required: false
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
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
  }
}, {
  timestamps: true
});

// Index for efficient queries
ExpenseSchema.index({ schoolId: 1, sessionId: 1, date: -1 });
ExpenseSchema.index({ category: 1, schoolId: 1, sessionId: 1 });

module.exports = mongoose.model('Expense', ExpenseSchema);
