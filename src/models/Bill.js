const mongoose = require('mongoose');
const BillSchema = new mongoose.Schema({
  billNumber: {
    type: String,
    required: true,
    unique: true
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
  // What this bill is for
  billType: {
    type: String,
    enum: [
      'TUITION', 'HOSTEL', 'TRANSPORT', 'EXAM',
      'ADMISSION', 'LIBRARY', 'SPORTS', 'MISCELLANEOUS'
    ],
    required: true
  },
  // Reference to the source document
  sourceType: {
    type: String,
    enum: [
      'StudentFee', 'ExamPayment', 'StudentHostel',
      'StudentTransport', 'Manual'
    ],
    required: true
  },
  sourceId: {
    type: mongoose.Schema.Types.ObjectId,
    required: false
  },
  description: {
    type: String,
    required: true
  },
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  paidAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  dueAmount: {
    type: Number,
    required: true,
    min: 0
  },
  status: {
    type: String,
    enum: ['UNPAID', 'PARTIAL', 'PAID', 'WAIVED', 'CANCELLED'],
    default: 'UNPAID'
  },
  dueDate: {
    type: Date
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, { timestamps: true });

// Pre-save: keep dueAmount in sync
BillSchema.pre('save', function(next) {
  this.dueAmount = this.totalAmount - this.paidAmount;
  if (this.dueAmount <= 0) {
    this.status = 'PAID';
    this.dueAmount = 0;
  } else if (this.paidAmount > 0) {
    this.status = 'PARTIAL';
  } else {
    this.status = 'UNPAID';
  }
  next();
});

BillSchema.index({ studentId: 1, schoolId: 1, status: 1 });
BillSchema.index({ schoolId: 1, billType: 1 });
BillSchema.index({ billNumber: 1 }, { unique: true });

module.exports = mongoose.model('Bill', BillSchema);
