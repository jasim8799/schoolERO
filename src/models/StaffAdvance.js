const mongoose = require('mongoose');

const StaffAdvanceSchema = new mongoose.Schema({
  staffId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0.01
  },
  month: {
    type: String, // YYYY-MM — which month this advance is for
    required: true
  },
  date: {
    type: Date,
    default: Date.now
  },
  reason: {
    type: String,
    default: ''
  },
  givenBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Payment tracking
  paymentStatus: {
    type: String,
    enum: ['PENDING', 'PAID', 'CLEARED'],
    default: 'PENDING'
  },
  paidAt: {
    type: Date,
    default: null
  },
  paidBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  paymentMode: {
    type: String,
    enum: ['cash', 'bank', null],
    default: null
  },
  clearedAt: {
    type: Date,
    default: null
  },
  clearedNote: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

StaffAdvanceSchema.index({ staffId: 1, schoolId: 1, month: 1 });
StaffAdvanceSchema.index({ schoolId: 1, paymentStatus: 1 });

module.exports = mongoose.model('StaffAdvance', StaffAdvanceSchema);
