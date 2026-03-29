const mongoose = require('mongoose');
const { emitEvent } = require('./event.service');

/**
 * Run all active AutomationRules for a given school and trigger type.
 * Called by the nightly scheduler.
 */
async function runAutomations(schoolId, trigger) {
  const AutomationRule = mongoose.model('AutomationRule');
  const rules = await AutomationRule.find({ schoolId, trigger, isActive: true }).lean();

  for (const rule of rules) {
    try {
      await _executeRule(rule);
      await AutomationRule.findByIdAndUpdate(rule._id, {
        $inc: { runCount: 1 },
        lastRunAt: new Date()
      });
    } catch (err) {
      console.error(`[AutomationService] Rule "${rule.name}" failed:`, err.message);
    }
  }
}

async function _executeRule(rule) {
  switch (rule.trigger) {
    case 'FEE_DUE':
      return checkFeesDue(rule.schoolId, rule.condition, rule.action);
    case 'STUDENT_ABSENT':
      return checkAbsentStudents(rule.schoolId, rule.condition, rule.action);
    case 'ATTENDANCE_NOT_MARKED':
      return checkAttendanceNotMarked(rule.schoolId, rule.condition, rule.action);
    default:
      break;
  }
}

/**
 * Check overdue fee assignments and queue reminders.
 */
async function checkFeesDue(schoolId, condition = {}, action = {}) {
  const StudentFeeAssignment = mongoose.model('StudentFeeAssignment');
  const NotificationQueue = mongoose.model('NotificationQueue');
  const Student = mongoose.model('Student');

  const dueBefore = new Date();
  const overdueAssignments = await StudentFeeAssignment.find({
    schoolId,
    status: { $in: ['PENDING', 'PARTIAL', 'OVERDUE'] },
    dueDate: { $lt: dueBefore }
  })
    .populate({ path: 'studentId', select: 'name parentId userId' })
    .lean();

  // Mark them overdue
  const ids = overdueAssignments.map(a => a._id);
  if (ids.length) {
    await StudentFeeAssignment.updateMany(
      { _id: { $in: ids } },
      { status: 'OVERDUE' }
    );
  }

  // Queue a notification per assignment
  const notifications = overdueAssignments
    .filter(a => a.studentId?.parentId)
    .map(a => ({
      schoolId,
      recipientId: a.studentId.parentId,
      recipientRole: 'PARENT',
      type: 'FEE_REMINDER',
      title: 'Fee Due Reminder',
      body: `Fee of ₹${a.totalAmount - a.paidAmount} for ${a.studentId.name} is overdue.`,
      relatedEntityId: a._id,
      relatedEntityType: 'StudentFeeAssignment'
    }));

  if (notifications.length) {
    await NotificationQueue.insertMany(notifications);
  }

  return overdueAssignments.length;
}

/**
 * Check for students who were absent yesterday and emit events.
 */
async function checkAbsentStudents(schoolId, condition = {}, action = {}) {
  const Attendance = mongoose.model('StudentDailyAttendance');
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  const dayEnd = new Date(yesterday);
  dayEnd.setHours(23, 59, 59, 999);

  const records = await Attendance.find({
    schoolId,
    date: { $gte: yesterday, $lte: dayEnd },
    status: 'ABSENT'
  }).lean();

  for (const rec of records) {
    await emitEvent({
      schoolId,
      event: 'STUDENT_ABSENT',
      entityId: rec.studentId,
      entityType: 'Student',
      triggeredBy: null,
      payload: { studentId: rec.studentId, date: yesterday.toISOString().split('T')[0] }
    });
  }

  return records.length;
}

/**
 * Check classes where attendance was not marked for yesterday.
 */
async function checkAttendanceNotMarked(schoolId, condition = {}, action = {}) {
  const Attendance = mongoose.model('StudentDailyAttendance');
  const Class = mongoose.model('Class');
  const NotificationQueue = mongoose.model('NotificationQueue');
  const User = mongoose.model('User');

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  const dayEnd = new Date(yesterday);
  dayEnd.setHours(23, 59, 59, 999);

  const classes = await Class.find({ schoolId }).select('_id name').lean();
  const marked = await Attendance.distinct('classId', {
    schoolId,
    date: { $gte: yesterday, $lte: dayEnd }
  });
  const markedSet = new Set(marked.map(id => String(id)));

  const unmarked = classes.filter(c => !markedSet.has(String(c._id)));
  if (!unmarked.length) return 0;

  // Find an active OPERATOR for this school to notify
  const operator = await User.findOne({
    schoolId,
    role: 'OPERATOR',
    status: 'active'
  }).select('_id').lean();

  const notifications = unmarked.map(c => ({
    schoolId,
    recipientId: operator?._id || schoolId,
    recipientRole: 'OPERATOR',
    type: 'GENERAL',
    title: 'Attendance Not Marked',
    body: `Attendance for class ${c.name} was not marked yesterday.`,
    relatedEntityId: c._id,
    relatedEntityType: 'Class'
  }));

  await NotificationQueue.insertMany(notifications);

  return unmarked.length;
}

/**
 * Generate monthly fee assignments for all active students in a school.
 * @param {*}      schoolId
 * @param {string} month - Format 'YYYY-MM', defaults to current month
 */
async function generateMonthlyFees(schoolId, month) {
  const StudentFeeAssignment = mongoose.model('StudentFeeAssignment');
  const Student = mongoose.model('Student');
  const FeeStructure = mongoose.model('FeeStructure');
  const AcademicSession = mongoose.model('AcademicSession');

  if (!month) {
    const now = new Date();
    month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  const session = await AcademicSession.findOne({ schoolId, isActive: true }).lean();
  if (!session) return 0;

  const students = await Student.find({ schoolId, status: 'ACTIVE' })
    .select('_id classId')
    .lean();

  let generated = 0;
  for (const student of students) {
    const structures = await FeeStructure.find({
      schoolId,
      sessionId: session._id,
      classId: student.classId,
      frequency: 'Monthly'
    }).lean();

    for (const fs of structures) {
      const exists = await StudentFeeAssignment.exists({
        studentId: student._id,
        feeStructureId: fs._id,
        month
      });
      if (exists) continue;

      const dueDate = new Date(`${month}-10`); // Due on 10th of month
      await StudentFeeAssignment.create({
        studentId: student._id,
        feeStructureId: fs._id,
        schoolId,
        sessionId: session._id,
        totalAmount: fs.amount,
        dueDate,
        month,
        generatedAt: new Date()
      });
      generated++;
    }
  }

  return generated;
}

module.exports = {
  runAutomations,
  checkFeesDue,
  checkAbsentStudents,
  checkAttendanceNotMarked,
  generateMonthlyFees
};
