const mongoose = require('mongoose');

const StaffAdvanceSchema = new mongoose.Schema({
  staffId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: [1, 'Amount must be positive'],
  },
  date: {
    type: Date,
    required: true,
    default: Date.now,
  },
  reason: {
    type: String,
    trim: true,
  },
  status: {
    type: String,
    enum: ['PAID', 'ADJUSTED'],
    default: 'PAID',
  },
  givenBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
}, {
  timestamps: true,
});

StaffAdvanceSchema.index({ staffId: 1, schoolId: 1 });

module.exports = mongoose.model('StaffAdvance', StaffAdvanceSchema);
