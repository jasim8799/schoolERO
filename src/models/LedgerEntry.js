const mongoose = require('mongoose');

const ledgerEntrySchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AcademicSession'
    },
    // DEBIT = money in (fee collection, revenue)
    // CREDIT = money out (salary, expenses)
    entryType: {
      type: String,
      enum: ['DEBIT', 'CREDIT'],
      required: true
    },
    category: {
      type: String,
      enum: [
        'FEE_COLLECTION',
        'HOSTEL_COLLECTION',
        'TRANSPORT_COLLECTION',
        'EXAM_COLLECTION',
        'SALARY_PAYMENT',
        'EXPENSE_PAYMENT',
        'OTHER'
      ],
      required: true
    },
    amount: { type: Number, required: true },
    description: { type: String },
    referenceId: { type: mongoose.Schema.Types.ObjectId }, // source doc _id
    sourceModel: {
      type: String,
      enum: ['Payment', 'SalaryPayment', 'Expense']
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    entryDate: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

ledgerEntrySchema.index({ schoolId: 1, entryDate: -1 });
ledgerEntrySchema.index({ schoolId: 1, category: 1 });
ledgerEntrySchema.index({ schoolId: 1, entryType: 1, entryDate: -1 });

module.exports = mongoose.model('LedgerEntry', ledgerEntrySchema);
