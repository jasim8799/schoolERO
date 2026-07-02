const mongoose = require('mongoose');

const FeeStructureSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  frequency: {
    type: String,
    enum: ['Monthly', 'Quarterly', 'One-time'],
    required: true
  },
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    required: true
  },
  sessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AcademicSession',
    required: false
  },
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    required: true
  },
  isOptional: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: ['ACTIVE', 'INACTIVE'],
    default: 'ACTIVE'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

FeeStructureSchema.index({ name: 1, classId: 1, sessionId: 1 }, { unique: true });
FeeStructureSchema.index({ schoolId: 1, sessionId: 1 });
FeeStructureSchema.index(
  { schoolId: 1, sessionId: 1, classId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: 'ACTIVE',
      isOptional: { $ne: true },
    },
  }
);

module.exports = mongoose.model('FeeStructure', FeeStructureSchema);
