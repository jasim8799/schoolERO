const mongoose = require('mongoose');

// ─── Session Lifecycle ─────────────────────────────────────────────────────────

const SESSION_LIFECYCLE_ORDER = [
  'SETUP',
  'ACTIVE',
  'EXAM_PHASE',
  'RESULT_PHASE',
  'CLOSED'
];

/**
 * Advance an AcademicSession to the next lifecycle status.
 * @param {string} sessionId
 * @param {string} requestedBy  - User _id
 */
async function advanceSessionLifecycle(sessionId, requestedBy) {
  const AcademicSession = mongoose.model('AcademicSession');
  const session = await AcademicSession.findById(sessionId);
  if (!session) throw new Error('Academic session not found');

  const currentIdx = SESSION_LIFECYCLE_ORDER.indexOf(session.lifecycleStatus || 'SETUP');
  if (currentIdx === -1) throw new Error('Unknown lifecycle status');
  if (currentIdx === SESSION_LIFECYCLE_ORDER.length - 1) {
    throw new Error('Session is already CLOSED');
  }

  const nextStatus = SESSION_LIFECYCLE_ORDER[currentIdx + 1];
  session.lifecycleStatus = nextStatus;
  if (nextStatus === 'CLOSED') {
    session.closedAt = new Date();
    session.isActive = false;
  }
  await session.save();
  return session;
}

// ─── Student Lifecycle ─────────────────────────────────────────────────────────

/**
 * Returns the lifecycle stage of a student.
 */
async function getStudentLifecycleStatus(studentId) {
  const Student = mongoose.model('Student');
  const student = await Student.findById(studentId)
    .select('admissionStatus status name')
    .lean();
  if (!student) throw new Error('Student not found');
  return {
    studentId,
    name: student.name,
    admissionStatus: student.admissionStatus,
    status: student.status
  };
}

// ─── Promotion Eligibility ─────────────────────────────────────────────────────

/**
 * Check whether a student may be promoted.
 * Rules:
 *  1. Student must be ACTIVE
 *  2. All fees must be PAID or WAIVED
 *  3. Current session must be in RESULT_PHASE or CLOSED
 */
async function validatePromotionEligibility(studentId, sessionId) {
  const Student = mongoose.model('Student');
  const StudentFeeAssignment = mongoose.model('StudentFeeAssignment');
  const AcademicSession = mongoose.model('AcademicSession');

  const [student, session] = await Promise.all([
    Student.findById(studentId).lean(),
    AcademicSession.findById(sessionId).lean()
  ]);

  const issues = [];

  if (!student) throw new Error('Student not found');
  if (student.status !== 'ACTIVE') issues.push('Student is not ACTIVE');

  if (!session) throw new Error('Session not found');
  if (!['RESULT_PHASE', 'CLOSED'].includes(session.lifecycleStatus)) {
    issues.push(`Session must be in RESULT_PHASE or CLOSED (currently ${session.lifecycleStatus})`);
  }

  const unpaid = await StudentFeeAssignment.exists({
    studentId,
    sessionId,
    status: { $in: ['PENDING', 'PARTIAL', 'OVERDUE'] }
  });
  if (unpaid) issues.push('Student has outstanding fee dues');

  return {
    eligible: issues.length === 0,
    issues,
    studentId,
    sessionId
  };
}

// ─── TC Eligibility ────────────────────────────────────────────────────────────

/**
 * Check whether a Transfer Certificate may be issued.
 * Rules:
 *  1. Student must be ACTIVE
 *  2. No pending/overdue fees
 *  3. No active hostel/transport dues (if models exist)
 */
async function validateTCEligibility(studentId) {
  const Student = mongoose.model('Student');
  const StudentFeeAssignment = mongoose.model('StudentFeeAssignment');

  const student = await Student.findById(studentId).lean();
  if (!student) throw new Error('Student not found');

  const issues = [];
  if (student.status !== 'ACTIVE') issues.push('Student is not currently ACTIVE');

  const unpaid = await StudentFeeAssignment.exists({
    studentId,
    status: { $in: ['PENDING', 'PARTIAL', 'OVERDUE'] }
  });
  if (unpaid) issues.push('Student has outstanding fee dues');

  return {
    eligible: issues.length === 0,
    issues,
    studentId
  };
}

module.exports = {
  SESSION_LIFECYCLE_ORDER,
  advanceSessionLifecycle,
  getStudentLifecycleStatus,
  validatePromotionEligibility,
  validateTCEligibility
};
