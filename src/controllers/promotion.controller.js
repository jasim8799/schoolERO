const mongoose = require('mongoose');
const Student = require('../models/Student.js');
const AcademicHistory = require('../models/AcademicHistory.js');
const Result = require('../models/Result.js');
const Class = require('../models/Class.js');
const Section = require('../models/Section.js');
const Bill = require('../models/Bill.js');
const AcademicSession = require('../models/AcademicSession.js');
const StudentTransport = require('../models/StudentTransport.js');
const StudentHostel = require('../models/StudentHostel.js');
const FeeStructure = require('../models/FeeStructure.js');
const StudentFee = require('../models/StudentFee.js');
const { auditLog } = require('../utils/auditLog.js');
const { USER_ROLES } = require('../config/constants.js');

const ALLOWED_ACTIONS = ['PROMOTE', 'RETAIN', 'GRADUATE', 'TRANSFER', 'INACTIVE'];
const FINAL_CLASS_ACTIONS = ['GRADUATE', 'TRANSFER', 'INACTIVE'];
const SECTION_STRATEGIES = ['KEEP_SAME_SECTION', 'MOVE_ENTIRE_CLASS', 'SPLIT_STUDENTS', 'MANUAL_ASSIGNMENT'];
const ROLL_STRATEGIES = ['AUTO_GENERATE', 'CONTINUE_EXISTING', 'MANUAL'];

const toId = (v) => (v == null ? '' : v.toString());
const normalizeAction = (action, fallback = 'RETAIN') => {
  const upper = (action || fallback).toString().toUpperCase();
  return ALLOWED_ACTIONS.includes(upper) ? upper : fallback;
};

const mapHistoryStatus = (action) => {
  if (action === 'PROMOTE') return 'Promoted';
  if (action === 'RETAIN') return 'Retained';
  if (action === 'GRADUATE') return 'Graduated';
  if (action === 'TRANSFER' || action === 'INACTIVE') return 'Left';
  return 'Retained';
};

const mapStudentStatus = (action) => {
  if (action === 'GRADUATE') return 'GRADUATED';
  if (action === 'TRANSFER') return 'LEFT';
  if (action === 'INACTIVE') return 'INACTIVE';
  return 'ACTIVE';
};

const buildBillNumber = (schoolId) => {
  const r = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `BILL-${toId(schoolId).slice(-4)}-${Date.now()}-${r}`;
};

async function getNextClass(currentClassId, schoolId, toSessionId) {
  const currentClass = await Class.findById(currentClassId).select('order');
  if (!currentClass) {
    throw new Error('Current class not found');
  }

  const nextOrder = (currentClass.order || 0) + 1;
  const nextClass = await Class.findOne({
    schoolId,
    sessionId: toSessionId,
    order: nextOrder,
    status: 'active',
  }).select('_id');

  return nextClass?._id || null;
}

async function ensurePromotionBasics({ schoolId, fromSessionId, toSessionId, destinationClassId }) {
  if (!fromSessionId || !toSessionId) {
    throw new Error('fromSessionId and toSessionId are required');
  }
  if (toId(fromSessionId) === toId(toSessionId)) {
    throw new Error('Sessions must be different');
  }

  const [fromSession, toSession, activeSession] = await Promise.all([
    AcademicSession.findOne({ _id: fromSessionId, schoolId }).select('_id name'),
    AcademicSession.findOne({ _id: toSessionId, schoolId }).select('_id name'),
    AcademicSession.findOne({ schoolId, isActive: true }).select('_id name'),
  ]);

  if (!fromSession) throw new Error('Source session not found for this school');
  if (!toSession) throw new Error('Destination session not found for this school');
  if (!activeSession) throw new Error('No active academic session found for this school');

  const targetClassCount = await Class.countDocuments({
    schoolId,
    sessionId: toSessionId,
    status: 'active',
  });
  if (targetClassCount === 0) {
    throw new Error('Target session has no classes. Run session setup first.');
  }

  if (destinationClassId) {
    const destinationClass = await Class.findOne({
      _id: destinationClassId,
      schoolId,
      sessionId: toSessionId,
      status: 'active',
    }).select('_id');
    if (!destinationClass) {
      throw new Error('Destination class not found in destination session');
    }
  }
}

async function buildPreviewPlan({
  schoolId,
  fromSessionId,
  toSessionId,
  classId,
  destinationClassId,
  sectionStrategy = 'KEEP_SAME_SECTION',
  destinationSectionId,
  splitSectionIds,
  manualSectionAssignments,
  rollStrategy = 'AUTO_GENERATE',
  manualRollNumbers,
  finalClassAction = 'GRADUATE',
  promotions,
  allowFeeOverride = false,
}) {
  await ensurePromotionBasics({ schoolId, fromSessionId, toSessionId, destinationClassId });

  const validatedSectionStrategy = SECTION_STRATEGIES.includes(sectionStrategy)
    ? sectionStrategy
    : 'KEEP_SAME_SECTION';
  const validatedRollStrategy = ROLL_STRATEGIES.includes(rollStrategy)
    ? rollStrategy
    : 'AUTO_GENERATE';
  const validatedFinalClassAction = FINAL_CLASS_ACTIONS.includes(finalClassAction)
    ? finalClassAction
    : 'GRADUATE';

  const students = await Student.find({
    classId,
    sessionId: fromSessionId,
    schoolId,
    status: 'ACTIVE',
  })
    .select('name rollNumber classId sectionId status')
    .lean();

  const studentIds = students.map((s) => s._id);
  const [dueList, results, currentClassDocs, currentSectionDocs, toSessionClasses] = await Promise.all([
    Bill.find({
      schoolId,
      sessionId: fromSessionId,
      studentId: { $in: studentIds },
      status: { $in: ['UNPAID', 'PARTIAL'] },
      dueAmount: { $gt: 0 },
    }).select('studentId'),
    Result.find({
      studentId: { $in: studentIds },
      sessionId: fromSessionId,
      schoolId,
      status: 'Published',
    }).select('studentId promotionStatus'),
    Class.find({ schoolId, sessionId: fromSessionId, status: 'active' }).select('_id name order').lean(),
    Section.find({ schoolId, sessionId: fromSessionId, status: 'active' }).select('_id name classId').lean(),
    Class.find({ schoolId, sessionId: toSessionId, status: 'active' }).select('_id name order').lean(),
  ]);

  const dueSet = new Set(dueList.map((b) => toId(b.studentId)));
  const promotionMap = {};
  results.forEach((r) => {
    promotionMap[toId(r.studentId)] = r.promotionStatus;
  });

  const classById = new Map(currentClassDocs.map((c) => [toId(c._id), c]));
  const sectionById = new Map(currentSectionDocs.map((s) => [toId(s._id), s]));
  const toClassById = new Map(toSessionClasses.map((c) => [toId(c._id), c]));
  const toClassByOrder = new Map(toSessionClasses.map((c) => [c.order, c]));

  const destinationClass = destinationClassId ? toClassById.get(toId(destinationClassId)) : null;
  const manualActionMap = new Map((promotions || []).map((p) => [toId(p.studentId), normalizeAction(p.action)]));
  const manualSectionMap = new Map((manualSectionAssignments || []).map((x) => [toId(x.studentId), toId(x.sectionId)]));
  const manualRollMap = new Map(Object.entries(manualRollNumbers || {}).map(([k, v]) => [k, String(v ?? '').trim()]));

  const baseRows = [];

  for (const student of students) {
    const sid = toId(student._id);
    const currentClass = classById.get(toId(student.classId));
    const currentSection = sectionById.get(toId(student.sectionId));
    const promotionStatus = promotionMap[sid] || 'NOT_ELIGIBLE';
    const feesCleared = !dueSet.has(sid);

    let action = 'RETAIN';
    let targetClassId = null;
    let remarks = [];

    if (promotionStatus === 'ELIGIBLE') {
      if (destinationClass) {
        action = 'PROMOTE';
        targetClassId = destinationClass._id;
      } else {
        const nextClass = toClassByOrder.get((currentClass?.order || 0) + 1);
        if (nextClass) {
          action = 'PROMOTE';
          targetClassId = nextClass._id;
        } else {
          action = validatedFinalClassAction;
        }
      }
    }

    if (!feesCleared && action === 'PROMOTE' && !allowFeeOverride) {
      action = 'RETAIN';
      remarks.push('Retained due to pending fee');
    }

    if (action === 'RETAIN') {
      const retainedClass = toClassByOrder.get(currentClass?.order || 0);
      targetClassId = retainedClass?._id || null;
      if (!targetClassId) {
        remarks.push('No same-order class found in destination session for retention');
      }
    }

    const overrideAction = manualActionMap.get(sid);
    if (overrideAction) {
      action = overrideAction;
      if (action === 'PROMOTE' && !targetClassId && destinationClass) {
        targetClassId = destinationClass._id;
      }
      if (['GRADUATE', 'TRANSFER', 'INACTIVE'].includes(action)) {
        targetClassId = null;
      }
    }

    baseRows.push({
      studentId: sid,
      name: student.name,
      currentRoll: student.rollNumber,
      currentClassId: toId(student.classId),
      currentClassName: currentClass?.name || '-',
      currentSectionId: toId(student.sectionId),
      currentSectionName: currentSection?.name || '-',
      destinationClassId: targetClassId ? toId(targetClassId) : null,
      destinationClassName: targetClassId ? (toClassById.get(toId(targetClassId))?.name || '-') : '-',
      suggestedNextClassId: targetClassId,
      promotionStatus,
      feesCleared,
      feeStatus: feesCleared ? 'CLEARED' : 'DUE',
      action,
      remarks,
    });
  }

  const targetClassIds = [...new Set(baseRows.map((r) => r.destinationClassId).filter(Boolean))];
  const destinationSections = await Section.find({
    schoolId,
    sessionId: toSessionId,
    classId: { $in: targetClassIds },
    status: 'active',
  }).select('_id name classId').lean();

  const sectionsByClass = new Map();
  destinationSections.forEach((s) => {
    const cid = toId(s.classId);
    const list = sectionsByClass.get(cid) || [];
    list.push(s);
    sectionsByClass.set(cid, list);
  });

  let splitIndex = 0;
  const validSplitIds = (splitSectionIds || []).map(toId).filter(Boolean);

  for (const row of baseRows) {
    const actionable = row.action === 'PROMOTE' || row.action === 'RETAIN';
    if (!actionable || !row.destinationClassId) {
      row.newSectionId = null;
      row.newSectionName = '-';
      continue;
    }

    const classSections = sectionsByClass.get(row.destinationClassId) || [];
    if (classSections.length === 0) {
      row.newSectionId = null;
      row.newSectionName = '-';
      row.remarks.push('No destination section found');
      continue;
    }

    let chosenSection = null;

    if (validatedSectionStrategy === 'MOVE_ENTIRE_CLASS') {
      chosenSection = classSections.find((s) => toId(s._id) === toId(destinationSectionId));
    } else if (validatedSectionStrategy === 'SPLIT_STUDENTS') {
      const inClassSplit = validSplitIds
        .map((id) => classSections.find((s) => toId(s._id) === id))
        .filter(Boolean);
      const pool = inClassSplit.length > 0 ? inClassSplit : classSections;
      chosenSection = pool[splitIndex % pool.length];
      splitIndex += 1;
    } else if (validatedSectionStrategy === 'MANUAL_ASSIGNMENT') {
      const manualSectionId = manualSectionMap.get(row.studentId);
      chosenSection = classSections.find((s) => toId(s._id) === manualSectionId);
    } else {
      chosenSection = classSections.find((s) => s.name === row.currentSectionName) || classSections[0];
    }

    if (!chosenSection) {
      row.newSectionId = null;
      row.newSectionName = '-';
      row.remarks.push('Section assignment missing');
      continue;
    }

    row.newSectionId = toId(chosenSection._id);
    row.newSectionName = chosenSection.name;
  }

  const activeRows = baseRows.filter((r) => (r.action === 'PROMOTE' || r.action === 'RETAIN') && r.destinationClassId && r.newSectionId);
  const destinationPairs = [...new Set(activeRows.map((r) => `${r.destinationClassId}:${r.newSectionId}`))];

  const existingDestStudents = await Student.find({
    schoolId,
    sessionId: toSessionId,
    status: 'ACTIVE',
    $or: destinationPairs.map((k) => {
      const [classIdKey, sectionIdKey] = k.split(':');
      return { classId: classIdKey, sectionId: sectionIdKey };
    }),
  }).select('classId sectionId rollNumber').lean();

  const usedRollsByBucket = new Map();
  existingDestStudents.forEach((s) => {
    const bucket = `${toId(s.classId)}:${toId(s.sectionId)}`;
    const set = usedRollsByBucket.get(bucket) || new Set();
    if (s.rollNumber != null) set.add(String(s.rollNumber));
    usedRollsByBucket.set(bucket, set);
  });

  const sortedForRoll = [...activeRows].sort((a, b) => a.name.localeCompare(b.name));

  for (const row of sortedForRoll) {
    const bucket = `${row.destinationClassId}:${row.newSectionId}`;
    const used = usedRollsByBucket.get(bucket) || new Set();

    if (validatedRollStrategy === 'MANUAL') {
      const manualRoll = manualRollMap.get(row.studentId);
      if (!manualRoll) {
        row.newRoll = null;
        row.remarks.push('Manual roll number missing');
      } else if (used.has(manualRoll)) {
        row.newRoll = manualRoll;
        row.remarks.push('Duplicate roll number detected');
      } else {
        row.newRoll = manualRoll;
        used.add(manualRoll);
      }
      usedRollsByBucket.set(bucket, used);
      continue;
    }

    const maxExisting = [...used].reduce((max, v) => {
      const n = Number(v);
      if (Number.isFinite(n)) return Math.max(max, n);
      return max;
    }, 0);

    const startAt = validatedRollStrategy === 'CONTINUE_EXISTING'
      ? maxExisting + 1
      : 1;

    let candidate = startAt;
    while (used.has(String(candidate))) {
      candidate += 1;
    }
    row.newRoll = String(candidate);
    used.add(String(candidate));
    usedRollsByBucket.set(bucket, used);
  }

  for (const row of baseRows) {
    if (row.action === 'PROMOTE' && !allowFeeOverride && !row.feesCleared) {
      row.remarks.push('Fee due: principal override required to promote');
    }
    if ((row.action === 'PROMOTE' || row.action === 'RETAIN') && !row.newRoll) {
      row.remarks.push('New roll number missing');
    }
  }

  const validationErrors = [];

  const duplicateStudentCheck = new Set();
  for (const row of baseRows) {
    if (duplicateStudentCheck.has(row.studentId)) {
      validationErrors.push(`Duplicate student in request: ${row.studentId}`);
    }
    duplicateStudentCheck.add(row.studentId);
  }

  const duplicateRollCheck = new Set();
  for (const row of baseRows) {
    if ((row.action === 'PROMOTE' || row.action === 'RETAIN') && row.newRoll) {
      const key = `${row.destinationClassId}:${row.newSectionId}:${row.newRoll}`;
      if (duplicateRollCheck.has(key)) {
        validationErrors.push(`Duplicate roll number ${row.newRoll} in destination section`);
      }
      duplicateRollCheck.add(key);
    }
  }

  baseRows.forEach((r) => {
    if ((r.action === 'PROMOTE' || r.action === 'RETAIN') && (!r.destinationClassId || !r.newSectionId)) {
      validationErrors.push(`Destination class/section missing for ${r.name}`);
    }
  });

  const meta = {
    sectionStrategy: validatedSectionStrategy,
    rollStrategy: validatedRollStrategy,
    finalClassAction: validatedFinalClassAction,
    destinationSections: destinationSections.map((s) => ({
      _id: toId(s._id),
      name: s.name,
      classId: toId(s.classId),
    })),
    safetyChecks: {
      destinationSessionExists: true,
      destinationClassExists: !destinationClassId || !!destinationClass,
      sectionExists: validationErrors.filter((e) => e.includes('section')).length === 0,
      rollNumbersUnique: validationErrors.filter((e) => e.includes('roll number')).length === 0,
      noDuplicateStudents: validationErrors.filter((e) => e.includes('Duplicate student')).length === 0,
      schoolIsolation: true,
      sessionIsolation: true,
      activeAcademicSession: true,
      feeValidation: true,
      studentActive: true,
    },
    validationErrors,
  };

  return { rows: baseRows, meta };
}

async function createFreshTuitionIfNeeded({ schoolId, toSessionId, principalUserId, plannedRows, mongoSession }) {
  const actionable = plannedRows.filter((r) => r.action === 'PROMOTE' || r.action === 'RETAIN');
  if (actionable.length === 0) {
    return { createdFees: 0, skippedNoStructure: 0 };
  }

  const classIds = [...new Set(actionable.map((r) => r.destinationClassId).filter(Boolean))];
  const structures = await FeeStructure.find({
    schoolId,
    classId: { $in: classIds },
    status: 'ACTIVE',
    isOptional: { $ne: true },
    $or: [{ sessionId: toSessionId }, { sessionId: { $exists: false } }, { sessionId: null }],
  }).session(mongoSession);

  const structureByClass = new Map();
  for (const s of structures) {
    const key = toId(s.classId);
    if (!structureByClass.has(key)) {
      structureByClass.set(key, s);
    }
  }

  let createdFees = 0;
  let skippedNoStructure = 0;

  for (const row of actionable) {
    const fs = structureByClass.get(toId(row.destinationClassId));
    if (!fs) {
      skippedNoStructure += 1;
      continue;
    }

    const exists = await StudentFee.findOne({
      studentId: row.studentId,
      feeStructureId: fs._id,
      sessionId: toSessionId,
      schoolId,
    })
      .select('_id')
      .session(mongoSession);

    if (exists) {
      continue;
    }

    const totalAmount = Number(fs.amount || 0);
    const feeDoc = await StudentFee.create([
      {
        studentId: row.studentId,
        feeStructureId: fs._id,
        totalAmount,
        paidAmount: 0,
        dueAmount: totalAmount,
        status: 'Due',
        sessionId: toSessionId,
        schoolId,
        assignedBy: principalUserId,
      },
    ], { session: mongoSession });

    const studentFee = feeDoc[0];
    let billNumber = buildBillNumber(schoolId);
    let attempts = 0;
    while (await Bill.findOne({ billNumber }).session(mongoSession)) {
      billNumber = buildBillNumber(schoolId);
      attempts += 1;
      if (attempts > 5) break;
    }

    await Bill.create([
      {
        billNumber,
        studentId: row.studentId,
        schoolId,
        sessionId: toSessionId,
        billType: 'TUITION',
        sourceType: 'StudentFee',
        sourceId: studentFee._id,
        description: fs.name || 'Tuition Fee',
        totalAmount,
        paidAmount: 0,
        dueAmount: totalAmount,
        status: 'UNPAID',
        dueDate: fs.dueDate || null,
        createdBy: principalUserId,
      },
    ], { session: mongoSession });

    createdFees += 1;
  }

  return { createdFees, skippedNoStructure };
}

const previewPromotion = async (req, res) => {
  try {
    const {
      fromSessionId,
      toSessionId,
      classId,
      destinationClassId,
      sectionStrategy,
      destinationSectionId,
      splitSectionIds,
      manualSectionAssignments,
      rollStrategy,
      manualRollNumbers,
      finalClassAction,
      promotions,
      allowFeeOverride,
    } = req.body;

    const schoolId = req.user.schoolId?._id || req.user.schoolId;
    const { rows, meta } = await buildPreviewPlan({
      schoolId,
      fromSessionId,
      toSessionId,
      classId,
      destinationClassId,
      sectionStrategy,
      destinationSectionId,
      splitSectionIds,
      manualSectionAssignments,
      rollStrategy,
      manualRollNumbers,
      finalClassAction,
      promotions,
      allowFeeOverride: !!allowFeeOverride,
    });

    return res.json({ success: true, data: rows, meta });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const executePromotion = async (req, res) => {
  const startedAt = Date.now();
  const mongoSession = await mongoose.startSession();

  try {
    const {
      fromSessionId,
      toSessionId,
      classId,
      destinationClassId,
      sectionStrategy,
      destinationSectionId,
      splitSectionIds,
      manualSectionAssignments,
      rollStrategy,
      manualRollNumbers,
      finalClassAction,
      promotions,
      allowFeeOverride,
      feeOverrideConfirmed,
      continueTransport,
      continueHostel,
    } = req.body;

    const schoolId = req.user.schoolId?._id || req.user.schoolId;
    const role = (req.user.role || '').toUpperCase();

    if (role !== USER_ROLES.PRINCIPAL) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const { rows, meta } = await buildPreviewPlan({
      schoolId,
      fromSessionId,
      toSessionId,
      classId,
      destinationClassId,
      sectionStrategy,
      destinationSectionId,
      splitSectionIds,
      manualSectionAssignments,
      rollStrategy,
      manualRollNumbers,
      finalClassAction,
      promotions,
      allowFeeOverride: !!allowFeeOverride,
    });

    if (meta.validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Safety checks failed',
        errors: meta.validationErrors,
      });
    }

    const feeDuePromotions = rows.filter((r) => r.action === 'PROMOTE' && !r.feesCleared);
    if (feeDuePromotions.length > 0 && !(allowFeeOverride && feeOverrideConfirmed)) {
      return res.status(400).json({
        success: false,
        message: 'Fee due students cannot be promoted without principal override confirmation',
        data: {
          feeDueCount: feeDuePromotions.length,
          studentIds: feeDuePromotions.map((r) => r.studentId),
        },
      });
    }

    const summary = {
      promoted: 0,
      retained: 0,
      graduated: 0,
      transferred: 0,
      inactive: 0,
      feeDueStudents: rows.filter((r) => !r.feesCleared).length,
      transportContinued: 0,
      hostelContinued: 0,
      rollNumbersGenerated: 0,
      sectionDistribution: {},
      errors: [],
    };

    await mongoSession.withTransaction(async () => {
      const studentIds = rows.map((r) => r.studentId);
      const students = await Student.find({
        _id: { $in: studentIds },
        schoolId,
        sessionId: fromSessionId,
      })
        .select('_id classId sectionId rollNumber status schoolId')
        .session(mongoSession);

      if (students.length !== rows.length) {
        throw new Error('School/session isolation check failed for one or more students');
      }

      const studentMap = new Map(students.map((s) => [toId(s._id), s]));

      const historyOps = [];
      const studentOps = [];

      for (const row of rows) {
        const st = studentMap.get(row.studentId);
        if (!st) {
          throw new Error(`Student not found: ${row.studentId}`);
        }

        const action = normalizeAction(row.action, 'RETAIN');
        const newStatus = mapStudentStatus(action);
        const historyStatus = mapHistoryStatus(action);

        historyOps.push({
          updateOne: {
            filter: {
              studentId: st._id,
              sessionId: fromSessionId,
              schoolId,
            },
            update: {
              $set: {
                fromSessionId,
                sessionId: fromSessionId,
                classId: st.classId,
                sectionId: st.sectionId,
                rollNumber: st.rollNumber,
                status: historyStatus,
              },
            },
            upsert: true,
          },
        });

        const updateDoc = {
          status: newStatus,
        };

        if (action === 'PROMOTE' || action === 'RETAIN') {
          updateDoc.sessionId = toSessionId;
          updateDoc.classId = row.destinationClassId;
          updateDoc.sectionId = row.newSectionId;
          updateDoc.rollNumber = row.newRoll;
          summary.rollNumbersGenerated += 1;
          const sdKey = `${row.destinationClassName}-${row.newSectionName}`;
          summary.sectionDistribution[sdKey] = (summary.sectionDistribution[sdKey] || 0) + 1;
        }

        studentOps.push({
          updateOne: {
            filter: { _id: st._id, schoolId },
            update: { $set: updateDoc },
          },
        });

        if (action === 'PROMOTE') summary.promoted += 1;
        if (action === 'RETAIN') summary.retained += 1;
        if (action === 'GRADUATE') summary.graduated += 1;
        if (action === 'TRANSFER') summary.transferred += 1;
        if (action === 'INACTIVE') summary.inactive += 1;

        const shouldContinueTransport = continueTransport !== false && (action === 'PROMOTE' || action === 'RETAIN');
        const shouldContinueHostel = continueHostel !== false && (action === 'PROMOTE' || action === 'RETAIN');

        if (!shouldContinueTransport) {
          await StudentTransport.updateMany(
            { studentId: st._id, schoolId, status: 'ACTIVE' },
            { $set: { status: 'INACTIVE' } },
            { session: mongoSession }
          );
        } else {
          summary.transportContinued += 1;
        }

        if (!shouldContinueHostel) {
          await StudentHostel.updateMany(
            { studentId: st._id, schoolId, status: 'ACTIVE' },
            { $set: { status: 'INACTIVE' } },
            { session: mongoSession }
          );
        } else {
          summary.hostelContinued += 1;
        }
      }

      if (historyOps.length) {
        await AcademicHistory.bulkWrite(historyOps, { session: mongoSession, ordered: true });
      }
      if (studentOps.length) {
        await Student.bulkWrite(studentOps, { session: mongoSession, ordered: true });
      }

      const tuitionResult = await createFreshTuitionIfNeeded({
        schoolId,
        toSessionId,
        principalUserId: req.user.userId,
        plannedRows: rows,
        mongoSession,
      });

      summary.tuitionAssigned = tuitionResult.createdFees;
      summary.tuitionSkippedNoStructure = tuitionResult.skippedNoStructure;
    });

    const executionTimeMs = Date.now() - startedAt;
    const report = {
      fromSessionId,
      toSessionId,
      classId,
      destinationClassId: destinationClassId || null,
      studentsPromoted: summary.promoted,
      studentsRetained: summary.retained,
      studentsGraduated: summary.graduated,
      studentsTransferred: summary.transferred,
      studentsInactive: summary.inactive,
      feeDueStudents: summary.feeDueStudents,
      transportContinued: summary.transportContinued,
      hostelContinued: summary.hostelContinued,
      sectionDistribution: summary.sectionDistribution,
      rollNumbersGenerated: summary.rollNumbersGenerated,
      executionTimeMs,
      principalName: req.user.name || 'Principal',
    };

    await auditLog({
      action: 'PROMOTION_EXECUTED',
      category: 'ACADEMIC',
      userId: req.user.userId,
      userName: req.user.name,
      role: req.user.role,
      entityType: 'PROMOTION',
      entityId: classId,
      description: `Promotion executed: ${summary.promoted} promoted, ${summary.retained} retained, ${summary.graduated} graduated`,
      schoolId,
      sessionId: toSessionId,
      details: {
        fromSessionId,
        toSessionId,
        classId,
        destinationClassId,
        ...report,
      },
      req,
    });

    return res.json({
      success: true,
      message: `Promotion complete: ${summary.promoted} promoted, ${summary.retained} retained, ${summary.graduated} graduated`,
      data: {
        ...summary,
        report,
      },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  } finally {
    await mongoSession.endSession();
  }
};

const executeAllPromotion = async (req, res) => {
  try {
    const {
      fromSessionId,
      toSessionId,
      allowFeeOverride,
      feeOverrideConfirmed,
      continueTransport,
      continueHostel,
    } = req.body;
    const schoolId = req.user.schoolId?._id || req.user.schoolId;
    const role = (req.user.role || '').toUpperCase();

    if (role !== USER_ROLES.PRINCIPAL) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const classes = await Class.find({
      sessionId: fromSessionId,
      schoolId,
      status: 'active',
    }).select('_id name');

    const aggregate = {
      promoted: 0,
      retained: 0,
      graduated: 0,
      transferred: 0,
      inactive: 0,
      feeDueStudents: 0,
      transportContinued: 0,
      hostelContinued: 0,
      rollNumbersGenerated: 0,
      sectionDistribution: {},
      tuitionAssigned: 0,
      tuitionSkippedNoStructure: 0,
      errors: [],
    };

    const startedAt = Date.now();

    for (const cls of classes) {
      try {
        const students = await Student.find({
          classId: cls._id,
          sessionId: fromSessionId,
          schoolId,
          status: 'ACTIVE',
        }).select('_id');

        const promotions = students.map((s) => ({ studentId: toId(s._id), action: 'PROMOTE' }));

        const { rows } = await buildPreviewPlan({
          schoolId,
          fromSessionId,
          toSessionId,
          classId: toId(cls._id),
          promotions,
          allowFeeOverride: !!allowFeeOverride,
        });

        const feeDuePromotions = rows.filter((r) => r.action === 'PROMOTE' && !r.feesCleared);
        if (feeDuePromotions.length > 0 && !(allowFeeOverride && feeOverrideConfirmed)) {
          aggregate.errors.push(
            `${cls.name || toId(cls._id)} skipped: fee override confirmation required for due students`
          );
          continue;
        }

        const mongoSession = await mongoose.startSession();
        try {
          await mongoSession.withTransaction(async () => {
            const studentIds = rows.map((r) => r.studentId);
            const dbStudents = await Student.find({
              _id: { $in: studentIds },
              schoolId,
              sessionId: fromSessionId,
            })
              .select('_id classId sectionId rollNumber status schoolId')
              .session(mongoSession);

            if (dbStudents.length !== rows.length) {
              throw new Error('School/session isolation check failed for one or more students');
            }

            const studentMap = new Map(dbStudents.map((s) => [toId(s._id), s]));
            const historyOps = [];
            const studentOps = [];

            for (const row of rows) {
              const st = studentMap.get(row.studentId);
              if (!st) throw new Error(`Student not found: ${row.studentId}`);

              const action = normalizeAction(row.action, 'RETAIN');
              const newStatus = mapStudentStatus(action);
              const historyStatus = mapHistoryStatus(action);

              historyOps.push({
                updateOne: {
                  filter: {
                    studentId: st._id,
                    sessionId: fromSessionId,
                    schoolId,
                  },
                  update: {
                    $set: {
                      fromSessionId,
                      sessionId: fromSessionId,
                      classId: st.classId,
                      sectionId: st.sectionId,
                      rollNumber: st.rollNumber,
                      status: historyStatus,
                    },
                  },
                  upsert: true,
                },
              });

              const updateDoc = { status: newStatus };
              if (action === 'PROMOTE' || action === 'RETAIN') {
                updateDoc.sessionId = toSessionId;
                updateDoc.classId = row.destinationClassId;
                updateDoc.sectionId = row.newSectionId;
                updateDoc.rollNumber = row.newRoll;
              }

              studentOps.push({
                updateOne: {
                  filter: { _id: st._id, schoolId },
                  update: { $set: updateDoc },
                },
              });

              if (action === 'PROMOTE') aggregate.promoted += 1;
              if (action === 'RETAIN') aggregate.retained += 1;
              if (action === 'GRADUATE') aggregate.graduated += 1;
              if (action === 'TRANSFER') aggregate.transferred += 1;
              if (action === 'INACTIVE') aggregate.inactive += 1;

              const shouldContinueTransport = continueTransport !== false && (action === 'PROMOTE' || action === 'RETAIN');
              const shouldContinueHostel = continueHostel !== false && (action === 'PROMOTE' || action === 'RETAIN');

              if (!shouldContinueTransport) {
                await StudentTransport.updateMany(
                  { studentId: st._id, schoolId, status: 'ACTIVE' },
                  { $set: { status: 'INACTIVE' } },
                  { session: mongoSession }
                );
              } else {
                aggregate.transportContinued += 1;
              }

              if (!shouldContinueHostel) {
                await StudentHostel.updateMany(
                  { studentId: st._id, schoolId, status: 'ACTIVE' },
                  { $set: { status: 'INACTIVE' } },
                  { session: mongoSession }
                );
              } else {
                aggregate.hostelContinued += 1;
              }

              if (row.newRoll) aggregate.rollNumbersGenerated += 1;
              if (row.newSectionName && row.destinationClassName) {
                const sdKey = `${row.destinationClassName}-${row.newSectionName}`;
                aggregate.sectionDistribution[sdKey] = (aggregate.sectionDistribution[sdKey] || 0) + 1;
              }
            }

            if (historyOps.length) {
              await AcademicHistory.bulkWrite(historyOps, { session: mongoSession, ordered: true });
            }
            if (studentOps.length) {
              await Student.bulkWrite(studentOps, { session: mongoSession, ordered: true });
            }

            const tuitionResult = await createFreshTuitionIfNeeded({
              schoolId,
              toSessionId,
              principalUserId: req.user.userId,
              plannedRows: rows,
              mongoSession,
            });

            aggregate.tuitionAssigned += tuitionResult.createdFees;
            aggregate.tuitionSkippedNoStructure += tuitionResult.skippedNoStructure;
            aggregate.feeDueStudents += rows.filter((r) => !r.feesCleared).length;
          });
        } finally {
          await mongoSession.endSession();
        }
      } catch (e) {
        aggregate.errors.push(`Class ${toId(cls._id)}: ${e.message}`);
      }
    }

    const executionTimeMs = Date.now() - startedAt;

    await auditLog({
      action: 'PROMOTION_EXECUTED',
      category: 'ACADEMIC',
      userId: req.user.userId,
      userName: req.user.name,
      role: req.user.role,
      entityType: 'PROMOTION',
      description: `Bulk promotion executed: ${aggregate.promoted} promoted, ${aggregate.retained} retained, ${aggregate.graduated} graduated`,
      schoolId,
      sessionId: toSessionId,
      details: {
        fromSessionId,
        toSessionId,
        executionTimeMs,
        ...aggregate,
      },
      req,
    });

    return res.json({
      success: true,
      message: 'All classes promoted',
      data: {
        ...aggregate,
        executionTimeMs,
      },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  previewPromotion,
  executePromotion,
  executeAllPromotion,
};
