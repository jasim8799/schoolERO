const mongoose = require('mongoose');
const WorkflowInstance = mongoose.model('WorkflowInstance');

// Step definitions for each workflow type
const WORKFLOW_STEPS = {
  ADMISSION_FLOW: [
    'ENQUIRY',
    'REGISTRATION',
    'DOCUMENT_COLLECTION',
    'DOCUMENT_VERIFICATION',
    'APPROVAL',
    'FEE_COLLECTION',
    'CLASS_ASSIGNMENT',
    'ADMITTED'
  ],
  EXAM_FLOW: [
    'EXAM_SCHEDULE_CREATED',
    'ADMIT_CARDS_GENERATED',
    'SEATING_ARRANGED',
    'EXAM_CONDUCTED',
    'ANSWER_SHEETS_COLLECTED',
    'MARKS_ENTERED',
    'RESULTS_VERIFIED',
    'RESULTS_PUBLISHED'
  ],
  FEE_FLOW: [
    'FEE_STRUCTURE_ASSIGNED',
    'INVOICE_GENERATED',
    'PAYMENT_PENDING',
    'PAYMENT_RECEIVED',
    'RECEIPT_ISSUED'
  ],
  SALARY_FLOW: [
    'ATTENDANCE_VERIFIED',
    'DEDUCTIONS_CALCULATED',
    'SALARY_GENERATED',
    'APPROVED',
    'SALARY_PAID'
  ],
  SESSION_SETUP_FLOW: [
    'SESSION_CREATED',
    'CLASSES_CONFIGURED',
    'SUBJECTS_ASSIGNED',
    'TEACHERS_ASSIGNED',
    'FEE_STRUCTURE_DEFINED',
    'SESSION_ACTIVATED'
  ],
  PROMOTION_FLOW: [
    'RESULTS_FINALIZED',
    'PROMOTION_LIST_GENERATED',
    'PARENT_NOTIFIED',
    'FEES_CLEARED_CHECK',
    'PROMOTED'
  ],
  TC_FLOW: [
    'TC_REQUESTED',
    'DUES_CLEARED',
    'PRINCIPAL_APPROVAL',
    'TC_GENERATED',
    'STUDENT_LEFT'
  ],
  HOSTEL_FLOW: [
    'APPLICATION_SUBMITTED',
    'ROOM_ALLOCATED',
    'FEE_COLLECTED',
    'MOVE_IN',
    'ACTIVE'
  ],
  TRANSPORT_FLOW: [
    'APPLICATION_SUBMITTED',
    'ROUTE_ASSIGNED',
    'FEE_COLLECTED',
    'PASS_ISSUED',
    'ACTIVE'
  ],
  STAFF_FLOW: [
    'APPLICATION_RECEIVED',
    'DOCUMENTS_VERIFIED',
    'INTERVIEW_DONE',
    'OFFER_ISSUED',
    'JOINED'
  ]
};

/**
 * Create a new workflow instance for an entity.
 * Will reuse an IN_PROGRESS workflow if one already exists.
 */
async function createWorkflow(schoolId, type, entityId, entityType, createdBy) {
  const existing = await WorkflowInstance.findOne({
    schoolId,
    type,
    entityId,
    status: 'IN_PROGRESS'
  });
  if (existing) return existing;

  const steps = (WORKFLOW_STEPS[type] || []).map((step, idx) => ({
    step,
    status: idx === 0 ? 'PENDING' : 'LOCKED'
  }));

  const instance = await WorkflowInstance.create({
    schoolId,
    type,
    entityId,
    entityType,
    status: 'IN_PROGRESS',
    steps,
    currentStep: steps[0]?.step || null,
    createdBy
  });
  return instance;
}

/**
 * Advance the workflow to the next step.
 * @param {string} workflowId  - WorkflowInstance _id
 * @param {string} completedBy - User _id completing the current step
 * @param {object} metadata    - Optional metadata for the completed step
 */
async function advanceWorkflow(workflowId, completedBy, metadata = {}) {
  const instance = await WorkflowInstance.findById(workflowId);
  if (!instance) throw new Error('Workflow not found');
  if (instance.status !== 'IN_PROGRESS') {
    throw new Error(`Workflow is already ${instance.status}`);
  }

  const currentIdx = instance.steps.findIndex(
    s => s.step === instance.currentStep && s.status === 'PENDING'
  );
  if (currentIdx === -1) throw new Error('Current step not in PENDING state');

  // Mark current step as COMPLETED
  instance.steps[currentIdx].status = 'COMPLETED';
  instance.steps[currentIdx].completedAt = new Date();
  instance.steps[currentIdx].completedBy = completedBy;
  instance.steps[currentIdx].metadata = metadata;

  const nextIdx = currentIdx + 1;
  if (nextIdx < instance.steps.length) {
    instance.steps[nextIdx].status = 'PENDING';
    instance.currentStep = instance.steps[nextIdx].step;
  } else {
    // All steps done
    instance.status = 'COMPLETED';
    instance.completedAt = new Date();
    instance.currentStep = null;
  }

  await instance.save();
  return instance;
}

/**
 * Cancel a workflow instance.
 */
async function cancelWorkflow(workflowId, cancelledBy) {
  const instance = await WorkflowInstance.findByIdAndUpdate(
    workflowId,
    { status: 'CANCELLED', completedAt: new Date() },
    { new: true }
  );
  return instance;
}

/**
 * Get workflow status for a given entity and type.
 */
async function getWorkflowStatus(schoolId, entityId, type) {
  const instance = await WorkflowInstance.findOne({
    schoolId,
    entityId,
    type
  }).sort({ createdAt: -1 });
  return instance;
}

/**
 * Check if a given step name is the current pending step.
 */
async function isStepAllowed(workflowId, stepName) {
  const instance = await WorkflowInstance.findById(workflowId);
  if (!instance || instance.status !== 'IN_PROGRESS') return false;
  return instance.currentStep === stepName;
}

module.exports = {
  WORKFLOW_STEPS,
  createWorkflow,
  advanceWorkflow,
  cancelWorkflow,
  getWorkflowStatus,
  isStepAllowed
};
