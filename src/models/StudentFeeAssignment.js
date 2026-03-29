const mongoose = require('mongoose');
const ObjectId = mongoose.Schema.Types.ObjectId;

const StudentFeeAssignmentSchema = new mongoose.Schema({
  studentId: { type: ObjectId, ref: 'Student', required: true },
  feeStructureId: { type: ObjectId, ref: 'FeeStructure', required: true },
  schoolId: { type: ObjectId, ref: 'School', required: true },
  sessionId: { type: ObjectId, ref: 'AcademicSession', required: true },
  totalAmount: { type: Number, required: true },
  paidAmount: { type: Number, default: 0 },
  dueAmount: { type: Number },          // computed: totalAmount - paidAmount
  status: {
    type: String,
    enum: ['PENDING', 'PARTIAL', 'PAID', 'OVERDUE', 'WAIVED'],
    default: 'PENDING'
  },
  dueDate: { type: Date },
  month: { type: String },    // '2025-04' for monthly fees
  generatedAt: { type: Date },
  assignedBy: { type: ObjectId, ref: 'User' }
}, { timestamps: true });

// Pre-save: keep dueAmount in sync
StudentFeeAssignmentSchema.pre('save', function(next) {
  this.dueAmount = this.totalAmount - this.paidAmount;
  next();
});

StudentFeeAssignmentSchema.index(
  { studentId: 1, feeStructureId: 1, month: 1 },
  { unique: true }
);
StudentFeeAssignmentSchema.index({ schoolId: 1, status: 1 });
StudentFeeAssignmentSchema.index({ dueDate: 1, status: 1 });

module.exports = mongoose.model('StudentFeeAssignment', StudentFeeAssignmentSchema);
