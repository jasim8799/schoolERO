const mongoose = require('mongoose');
const ObjectId = mongoose.Schema.Types.ObjectId;

const WorkflowInstanceSchema = new mongoose.Schema({
  schoolId: { type: ObjectId, ref: 'School', required: true },
  type: {
    type: String,
    enum: [
      'ADMISSION_FLOW',
      'STAFF_FLOW',
      'SESSION_SETUP_FLOW',
      'EXAM_FLOW',
      'FEE_FLOW',
      'SALARY_FLOW',
      'HOSTEL_FLOW',
      'TRANSPORT_FLOW',
      'TC_FLOW',
      'PROMOTION_FLOW'
    ],
    required: true
  },
  status: {
    type: String,
    enum: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
    default: 'IN_PROGRESS'
  },
  entityId: { type: ObjectId },
  entityType: { type: String },
  steps: [{
    step: { type: String, required: true },
    status: {
      type: String,
      enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'LOCKED', 'SKIPPED'],
      default: 'LOCKED'
    },
    completedAt: { type: Date },
    completedBy: { type: ObjectId, ref: 'User' },
    metadata: { type: mongoose.Schema.Types.Mixed }
  }],
  currentStep: { type: String },
  createdBy: { type: ObjectId, ref: 'User', required: true },
  completedAt: { type: Date }
}, { timestamps: true });

WorkflowInstanceSchema.index({ schoolId: 1, type: 1, status: 1 });
WorkflowInstanceSchema.index({ entityId: 1 });

module.exports = mongoose.model('WorkflowInstance', WorkflowInstanceSchema);
