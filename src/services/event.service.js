const mongoose = require('mongoose');
const EventLog = mongoose.model('EventLog');

// Registry of event handlers: { eventName: [handlerFn, ...] }
const _handlers = {};

/**
 * Register a handler function for a specific event.
 * @param {string}   event   - Event name (e.g. 'FEE_PAID')
 * @param {function} handler - async fn(eventDoc) => void
 */
function registerHandler(event, handler) {
  if (!_handlers[event]) _handlers[event] = [];
  _handlers[event].push(handler);
}

/**
 * Emit an event: persist to EventLog and run all registered handlers.
 * @param {object} opts
 * @param {*}      opts.schoolId
 * @param {string} opts.event
 * @param {*}      opts.entityId
 * @param {string} opts.entityType
 * @param {*}      opts.triggeredBy
 * @param {object} [opts.payload={}]
 */
async function emitEvent({ schoolId, event, entityId, entityType, triggeredBy, payload = {} }) {
  const log = await EventLog.create({
    schoolId,
    event,
    entityId,
    entityType,
    triggeredBy,
    payload
  });

  const handlers = _handlers[event] || [];
  await Promise.allSettled(
    handlers.map(fn =>
      fn(log).catch(err =>
        console.error(`[EventService] handler error for ${event}:`, err.message)
      )
    )
  );

  return log;
}

// ── Built-in Handlers ─────────────────────────────────────────────────────────

// FEE_PAID → update StudentFeeAssignment status
registerHandler('FEE_PAID', async (log) => {
  const StudentFeeAssignment = mongoose.model('StudentFeeAssignment');
  const { studentId, feeStructureId, amountPaid } = log.payload || {};
  if (!studentId || !feeStructureId) return;

  const assignment = await StudentFeeAssignment.findOne({
    studentId,
    feeStructureId
  });
  if (!assignment) return;

  assignment.paidAmount = (assignment.paidAmount || 0) + (amountPaid || 0);
  if (assignment.paidAmount >= assignment.totalAmount) {
    assignment.status = 'PAID';
  } else if (assignment.paidAmount > 0) {
    assignment.status = 'PARTIAL';
  }
  await assignment.save();

  log.processedBy.push('FEE_ASSIGNMENT_UPDATER');
  await log.save();
});

// STUDENT_ABSENT → queue notification to parent
registerHandler('STUDENT_ABSENT', async (log) => {
  const NotificationQueue = mongoose.model('NotificationQueue');
  const Student = mongoose.model('Student');
  const { studentId, date } = log.payload || {};
  if (!studentId) return;

  const student = await Student.findById(studentId).select('name parentId').lean();
  if (!student || !student.parentId) return;

  await NotificationQueue.create({
    schoolId: log.schoolId,
    recipientId: student.parentId,
    recipientRole: 'PARENT',
    type: 'ABSENT_ALERT',
    title: 'Attendance Alert',
    body: `${student.name} was marked absent on ${date || 'today'}.`,
    relatedEntityId: studentId,
    relatedEntityType: 'Student'
  });

  log.processedBy.push('ABSENT_NOTIFIER');
  await log.save();
});

// RESULT_PUBLISHED → queue notifications to students
registerHandler('RESULT_PUBLISHED', async (log) => {
  const NotificationQueue = mongoose.model('NotificationQueue');
  const { classId, sessionId } = log.payload || {};

  await NotificationQueue.create({
    schoolId: log.schoolId,
    recipientId: log.triggeredBy,
    recipientRole: 'PRINCIPAL',
    type: 'RESULT_READY',
    title: 'Results Published',
    body: 'Exam results have been published and are now visible to students.',
    relatedEntityId: log.entityId,
    relatedEntityType: log.entityType
  });

  log.processedBy.push('RESULT_NOTIFIER');
  await log.save();
});

// SALARY_PAID → optionally log
registerHandler('SALARY_PAID', async (log) => {
  log.processedBy.push('SALARY_TRACKER');
  await log.save();
});

// STUDENT_PROMOTED → record in student history (payload carries from/to class)
registerHandler('STUDENT_PROMOTED', async (log) => {
  // History can be appended to Student.promotionHistory if that field exists
  log.processedBy.push('PROMOTION_TRACKER');
  await log.save();
});

// TC_ISSUED → mark student as LEFT
registerHandler('TC_ISSUED', async (log) => {
  const Student = mongoose.model('Student');
  if (!log.entityId) return;
  await Student.findByIdAndUpdate(log.entityId, {
    status: 'LEFT',
    admissionStatus: 'ACTIVE'   // keep history intact
  });
  log.processedBy.push('TC_STATUS_UPDATER');
  await log.save();
});

module.exports = { emitEvent, registerHandler };
