const mongoose = require('mongoose');
const Bill = require('../models/Bill');
const StudentFeeAssignment = require('../models/StudentFeeAssignment');

const MONTH_NAMES = [
  '',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const getMonthLabel = (monthStr) => {
  if (!monthStr || typeof monthStr !== 'string') return '';
  const [y, m] = monthStr.split('-').map((v) => Number(v));
  if (!y || !m || m < 1 || m > 12) return '';
  return `${MONTH_NAMES[m]} ${y}`;
};

const generateBillNumber = (schoolId) => {
  const ts = Date.now();
  const r = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0');
  return `BILL-${schoolId.toString().slice(-4)}-${ts}-${r}`;
};

const buildSessionFilter = (sessionId) => {
  if (!sessionId) return {};
  return {
    $or: [
      { sessionId: new mongoose.Types.ObjectId(sessionId.toString()) },
      { sessionId: { $exists: false } },
      { sessionId: null },
    ],
  };
};

const computeDueAmount = (assignment) => {
  const total = Number(assignment.totalAmount || 0);
  const paid = Number(assignment.paidAmount || 0);
  const due = Number.isFinite(assignment.dueAmount)
    ? Number(assignment.dueAmount)
    : total - paid;
  return Math.max(0, due);
};

const buildBillDescription = (assignment) => {
  const feeName = assignment.feeStructureId?.name || 'Monthly Fee';
  const monthLabel = getMonthLabel(assignment.month);
  return monthLabel ? `${monthLabel} ${feeName}` : feeName;
};

async function ensureStudentPendingAssignmentBills({
  schoolId,
  studentId,
  sessionId,
  createdBy,
}) {
  if (!schoolId || !studentId) return { created: 0 };

  const assignmentFilter = {
    schoolId: new mongoose.Types.ObjectId(schoolId.toString()),
    studentId: new mongoose.Types.ObjectId(studentId.toString()),
    status: { $in: ['PENDING', 'PARTIAL', 'OVERDUE'] },
    ...buildSessionFilter(sessionId),
  };

  const assignments = await StudentFeeAssignment.find(assignmentFilter)
    .populate('feeStructureId', 'name')
    .lean();

  let created = 0;

  for (const assignment of assignments) {
    const dueAmount = computeDueAmount(assignment);
    if (dueAmount <= 0) continue;

    const existing = await Bill.findOne({
      schoolId: assignment.schoolId,
      studentId: assignment.studentId,
      sourceType: 'StudentFeeAssignment',
      sourceId: assignment._id,
    })
      .select('_id')
      .lean();

    if (existing) continue;

    let billNumber;
    let attempts = 0;
    do {
      billNumber = generateBillNumber(schoolId);
      attempts += 1;
      if (attempts > 10) break;
    } while (await Bill.findOne({ billNumber }).select('_id').lean());

    const totalAmount = Number(assignment.totalAmount || 0);
    const paidAmount = Math.max(0, totalAmount - dueAmount);

    await Bill.create({
      billNumber,
      studentId: assignment.studentId,
      schoolId: assignment.schoolId,
      sessionId: assignment.sessionId || null,
      billType: 'TUITION',
      sourceType: 'StudentFeeAssignment',
      sourceId: assignment._id,
      description: buildBillDescription(assignment),
      totalAmount,
      paidAmount,
      dueAmount,
      status: dueAmount === totalAmount ? 'UNPAID' : 'PARTIAL',
      dueDate: assignment.dueDate || null,
      createdBy: createdBy || assignment.assignedBy || assignment.studentId,
    });

    created += 1;
  }

  return { created };
}

async function ensureSchoolPendingAssignmentBills({ schoolId, sessionId, createdBy }) {
  if (!schoolId) return { created: 0 };

  const assignmentFilter = {
    schoolId: new mongoose.Types.ObjectId(schoolId.toString()),
    status: { $in: ['PENDING', 'PARTIAL', 'OVERDUE'] },
    ...buildSessionFilter(sessionId),
  };

  const studentIds = await StudentFeeAssignment.distinct('studentId', assignmentFilter);
  let created = 0;

  for (const sid of studentIds) {
    const result = await ensureStudentPendingAssignmentBills({
      schoolId,
      studentId: sid,
      sessionId,
      createdBy,
    });
    created += result.created;
  }

  return { created };
}

module.exports = {
  ensureStudentPendingAssignmentBills,
  ensureSchoolPendingAssignmentBills,
};
