const AcademicSession = require('../models/AcademicSession');
const FeeStructure = require('../models/FeeStructure');
const StudentFee = require('../models/StudentFee');
const Bill = require('../models/Bill');
const { dispatchAutomationTrigger } = require('./automation.service');

const resolveSessionId = async ({ schoolId, sessionId }) => {
  if (sessionId) return sessionId;
  const activeSession = await AcademicSession.findOne({ schoolId, isActive: true }).select('_id').lean();
  return activeSession?._id || null;
};

const buildFeeStructureFilter = ({ schoolId, classId, sessionId }) => {
  const filter = {
    schoolId,
    classId,
    status: 'ACTIVE',
    isOptional: { $ne: true },
  };

  if (sessionId) {
    filter.$or = [{ sessionId }, { sessionId: { $exists: false } }, { sessionId: null }];
  }

  return filter;
};

const findActiveClassTuitionFeeStructure = async ({ schoolId, classId, sessionId }) => {
  const effectiveSessionId = await resolveSessionId({ schoolId, sessionId });
  const filter = buildFeeStructureFilter({
    schoolId,
    classId,
    sessionId: effectiveSessionId,
  });

  const structure = await FeeStructure.findOne(filter)
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();

  return {
    sessionId: effectiveSessionId,
    feeStructure: structure || null,
  };
};

const generateBillNumber = async (schoolId) => {
  let attempts = 0;
  let billNumber;

  do {
    const ts = Date.now();
    const r = Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0');
    billNumber = `BILL-${schoolId.toString().slice(-4)}-${ts}-${r}`;
    attempts += 1;
    if (attempts > 10) break;
  } while (await Bill.findOne({ billNumber }).select('_id').lean());

  return billNumber;
};

const createStudentFeeFromStructure = async ({
  studentId,
  schoolId,
  sessionId,
  assignedBy,
  feeStructure,
  overrideAmount,
}) => {
  if (!feeStructure) {
    return {
      created: false,
      studentFee: null,
      reason: 'NO_FEE_STRUCTURE',
    };
  }

  const existing = await StudentFee.findOne({
    studentId,
    feeStructureId: feeStructure._id,
    sessionId,
    schoolId,
  });

  if (existing) {
    return {
      created: false,
      studentFee: existing,
      reason: 'ALREADY_ASSIGNED',
    };
  }

  const totalAmount = Number(overrideAmount ?? feeStructure.amount ?? 0);
  const studentFee = await StudentFee.create({
    studentId,
    feeStructureId: feeStructure._id,
    totalAmount,
    paidAmount: 0,
    dueAmount: totalAmount,
    status: 'Due',
    sessionId,
    schoolId,
    assignedBy,
  });

  try {
    const billNumber = await generateBillNumber(schoolId);
    await Bill.create({
      billNumber,
      studentId,
      schoolId,
      sessionId,
      billType: 'TUITION',
      sourceType: 'StudentFee',
      sourceId: studentFee._id,
      description: feeStructure.name,
      totalAmount,
      paidAmount: 0,
      dueAmount: totalAmount,
      status: 'UNPAID',
      dueDate: feeStructure.dueDate || null,
      createdBy: assignedBy,
    });
  } catch (billErr) {
    console.error('[StudentFeeAutoAssign] Bill dual-write failed:', billErr.message);
  }

  await dispatchAutomationTrigger(schoolId, 'FEE_DUE', {
    entityId: studentFee._id,
    entityType: 'StudentFee',
    studentId,
    feeStructureId: feeStructure._id,
    dueAmount: totalAmount,
    totalAmount,
    feeName: feeStructure.name,
    message: `${feeStructure.name} fee has been assigned and is now due.`,
  });

  return {
    created: true,
    studentFee,
    reason: null,
  };
};

const autoAssignClassTuitionFee = async ({
  studentId,
  classId,
  schoolId,
  sessionId,
  assignedBy,
  overrideAmount,
}) => {
  const resolved = await findActiveClassTuitionFeeStructure({
    schoolId,
    classId,
    sessionId,
  });

  if (!resolved.feeStructure) {
    return {
      assigned: false,
      reason: 'NO_ACTIVE_FEE_STRUCTURE',
      sessionId: resolved.sessionId,
      feeStructure: null,
      studentFee: null,
    };
  }

  const result = await createStudentFeeFromStructure({
    studentId,
    schoolId,
    sessionId: resolved.sessionId,
    assignedBy,
    feeStructure: resolved.feeStructure,
    overrideAmount,
  });

  return {
    assigned: result.created,
    reason: result.reason,
    sessionId: resolved.sessionId,
    feeStructure: resolved.feeStructure,
    studentFee: result.studentFee,
  };
};

module.exports = {
  resolveSessionId,
  findActiveClassTuitionFeeStructure,
  createStudentFeeFromStructure,
  autoAssignClassTuitionFee,
};
