const mongoose = require('mongoose');
const { USER_STATUS } = require('../config/constants');

const ROLE_MAP = {
  STUDENT: ['STUDENT'],
  PARENT: ['PARENT'],
  TEACHER: ['TEACHER'],
  OPERATOR: ['OPERATOR'],
  PRINCIPAL: ['PRINCIPAL'],
  ALL: ['STUDENT', 'PARENT', 'TEACHER', 'OPERATOR', 'PRINCIPAL'],
};

function getTriggerTitle(trigger) {
  const map = {
    FEE_DUE: 'Fee Payment Reminder',
    FEE_OVERDUE: 'Fee Overdue Alert',
    EXAM_PUBLISHED: 'New Exam Published',
    RESULT_PUBLISHED: 'Results Published',
    ADMIT_CARD_PUBLISHED: 'Admit Card Ready',
    HOMEWORK_ASSIGNED: 'Homework Assigned',
    PTM_SCHEDULED: 'PTM Scheduled',
    LOW_ATTENDANCE: 'Low Attendance Alert',
    TC_ISSUED: 'Transfer Certificate Issued',
  };
  return map[trigger] || trigger.replaceAll('_', ' ');
}

function evaluateCondition(condition, context = {}) {
  if (!condition?.field || condition.value === undefined || !condition.operator) {
    return true;
  }

  const left = context[condition.field];
  const right = condition.value;

  switch (condition.operator) {
    case 'gt':
      return left > right;
    case 'lt':
      return left < right;
    case 'eq':
      return left === right;
    case 'gte':
      return left >= right;
    case 'lte':
      return left <= right;
    default:
      return true;
  }
}

async function resolveFeeContext(schoolId) {
  const Bill = mongoose.model('Bill');
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);

  const [feeDueCount, feeOverdueCount] = await Promise.all([
    Bill.countDocuments({
      schoolId,
      status: { $in: ['UNPAID', 'PARTIAL'] },
      dueAmount: { $gt: 0 },
      dueDate: { $gte: startOfToday, $lt: endOfToday },
    }),
    Bill.countDocuments({
      schoolId,
      status: { $in: ['UNPAID', 'PARTIAL'] },
      dueAmount: { $gt: 0 },
      dueDate: { $lt: startOfToday },
    }),
  ]);

  return { feeDueCount, feeOverdueCount };
}

function buildDefaultMessage(rule, trigger, context = {}) {
  if (rule.action?.message) {
    return rule.action.message;
  }

  switch (trigger) {
    case 'FEE_DUE':
      return context.message || 'Fee payment is due. Please pay on time to avoid penalties.';
    case 'FEE_OVERDUE':
      return context.message || 'Fee payment is overdue. Please clear the pending amount immediately.';
    case 'EXAM_PUBLISHED':
      return context.message || `A new exam has been published${context.examName ? `: ${context.examName}` : ''}.`;
    case 'RESULT_PUBLISHED':
      return context.message || `Results have been published${context.examName ? ` for ${context.examName}` : ''}.`;
    case 'ADMIT_CARD_PUBLISHED':
      return context.message || `Admit card${context.examName ? ` for ${context.examName}` : ''} is ready to download.`;
    case 'HOMEWORK_ASSIGNED':
      return context.message || `New homework has been assigned.`;
    case 'PTM_SCHEDULED':
      return context.message || `A Parent-Teacher Meeting has been scheduled.`;
    case 'LOW_ATTENDANCE':
      return context.message || `Your attendance has dropped below the required threshold.`;
    case 'TC_ISSUED':
      return context.message || `A Transfer Certificate has been issued.`;
    default:
      return `${getTriggerTitle(trigger)} - ${rule.name}`;
  }
}

async function queueNotifications(schoolId, trigger, rule, context = {}) {
  const NotificationQueue = mongoose.model('NotificationQueue');
  const User = mongoose.model('User');
  const roles = ROLE_MAP[rule.action?.target] || [];

  if (!roles.length) {
    return 0;
  }

  const users = await User.find({
    schoolId,
    role: { $in: roles },
    status: USER_STATUS.ACTIVE,
  }).select('_id role').lean();

  if (!users.length) {
    return 0;
  }

  const title = getTriggerTitle(trigger);
  const body = buildDefaultMessage(rule, trigger, context);
  const notifications = users.map((user) => ({
    schoolId,
    recipientId: user._id,
    recipientRole: user.role,
    type: trigger === 'RESULT_PUBLISHED'
        ? 'RESULT_READY'
        : trigger === 'ATTENDANCE_ABSENT'
            ? 'ABSENT_ALERT'
            : trigger.startsWith('FEE_')
                ? 'FEE_REMINDER'
                : trigger === 'EXAM_PUBLISHED'
                    ? 'EXAM_ALERT'
                    : 'GENERAL',
    title,
    body,
    relatedEntityId: context.entityId || null,
    relatedEntityType: context.entityType || 'AutomationRule',
  }));

  await NotificationQueue.insertMany(notifications, { ordered: false });
  return notifications.length;
}

async function dispatchAutomationTrigger(schoolId, trigger, context = {}) {
  const AutomationRule = mongoose.model('AutomationRule');
  const rules = await AutomationRule.find({ schoolId, trigger, isActive: true }).lean();

  if (!rules.length) {
    return { rulesRun: 0, notificationsCreated: 0 };
  }

  let rulesRun = 0;
  let notificationsCreated = 0;

  for (const rule of rules) {
    if (!evaluateCondition(rule.condition, context)) {
      continue;
    }

    try {
      if (rule.action?.type === 'SEND_NOTIFICATION' || !rule.action?.type) {
        notificationsCreated += await queueNotifications(schoolId, trigger, rule, context);
      }

      await AutomationRule.updateOne(
        { _id: rule._id },
        {
          $inc: { runCount: 1 },
          $set: {
            lastRunAt: new Date(),
            lastDispatchedAt: new Date(),
          }
        }
      );
      rulesRun += 1;
    } catch (err) {
      console.error(`[AutomationService] Rule "${rule.name}" failed:`, err.message);
    }
  }

  return { rulesRun, notificationsCreated };
}

/**
 * Run all active AutomationRules for a given school and trigger type.
 * Called by the nightly scheduler.
 */
async function runAutomations(schoolId, trigger) {
  let context = {};

  if (trigger === 'FEE_DUE' || trigger === 'FEE_OVERDUE') {
    context = await resolveFeeContext(schoolId);

    if (trigger === 'FEE_DUE' && context.feeDueCount <= 0) {
      return { rulesRun: 0, notificationsCreated: 0 };
    }

    if (trigger === 'FEE_OVERDUE' && context.feeOverdueCount <= 0) {
      return { rulesRun: 0, notificationsCreated: 0 };
    }
  }

  return dispatchAutomationTrigger(schoolId, trigger, context);
}

/**
 * Return counts for fee-due and fee-overdue states.
 */
async function checkFeesDue(schoolId) {
  return resolveFeeContext(schoolId);
}

/**
 * Trigger attendance-absent automations for a specific absent record or for all absentees today.
 */
async function checkAbsentStudents(schoolId, context = {}) {
  const Attendance = mongoose.model('StudentDailyAttendance');
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const query = {
    schoolId,
    status: 'ABSENT',
    date: { $gte: startOfDay, $lt: endOfDay },
  };

  if (context.studentId) {
    query.studentId = context.studentId;
  }

  const records = await Attendance.find(query)
    .populate('studentId', 'name')
    .lean();

  for (const rec of records) {
    await dispatchAutomationTrigger(schoolId, 'ATTENDANCE_ABSENT', {
      entityId: rec.studentId?._id || rec.studentId,
      entityType: 'Student',
      studentId: rec.studentId?._id || rec.studentId,
      studentName: rec.studentId?.name,
      date: startOfDay.toISOString().split('T')[0],
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
  getTriggerTitle,
  dispatchAutomationTrigger,
  runAutomations,
  checkFeesDue,
  checkAbsentStudents,
  checkAttendanceNotMarked,
  generateMonthlyFees
};
