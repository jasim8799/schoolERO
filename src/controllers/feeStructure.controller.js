const FeeStructure = require('../models/FeeStructure');
const Class = require('../models/Class');
const AcademicSession = require('../models/AcademicSession');
const StudentFee = require('../models/StudentFee');
const StudentFeeAssignment = require('../models/StudentFeeAssignment');
const Bill = require('../models/Bill');

const getSessionFilter = (req) => {
  const sessionId = req.user?.sessionId;
  return sessionId ? { $or: [{ sessionId }, { sessionId: { $exists: false } }] } : {};
};

const normalizeStatus = (status) => {
  if (!status) return 'ACTIVE';
  const value = status.toString().toUpperCase();
  return value === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
};

const isTuitionStructure = (payload = {}) => payload.isOptional !== true;

const activeTuitionExists = async ({ schoolId, classId, sessionId, excludeId }) => {
  if (!classId) return false;
  const filter = {
    schoolId,
    classId,
    sessionId,
    status: 'ACTIVE',
    isOptional: { $ne: true },
  };
  if (excludeId) filter._id = { $ne: excludeId };
  const existing = await FeeStructure.findOne(filter).select('_id name').lean();
  return existing;
};

const resolveActiveSessionId = async (schoolId) => {
  const activeSession = await AcademicSession.findOne({ schoolId, isActive: true }).select('_id').lean();
  return activeSession?._id || null;
};

const mapUsageCounts = async (structures, schoolId) => {
  const ids = structures.map((s) => s._id);
  if (ids.length === 0) return new Map();

  const [studentFeeAgg, assignmentAgg] = await Promise.all([
    StudentFee.aggregate([
      { $match: { schoolId, feeStructureId: { $in: ids } } },
      { $group: { _id: '$feeStructureId', count: { $sum: 1 } } },
    ]),
    StudentFeeAssignment.aggregate([
      { $match: { schoolId, feeStructureId: { $in: ids } } },
      { $group: { _id: '$feeStructureId', count: { $sum: 1 } } },
    ]),
  ]);

  const counts = new Map();
  for (const row of studentFeeAgg) {
    counts.set(row._id.toString(), Number(row.count || 0));
  }
  for (const row of assignmentAgg) {
    const key = row._id.toString();
    counts.set(key, Number(counts.get(key) || 0) + Number(row.count || 0));
  }

  return counts;
};

const isFeeStructureInUse = async ({ feeStructureId, schoolId }) => {
  const [studentFeeExists, assignmentExists] = await Promise.all([
    StudentFee.exists({ feeStructureId, schoolId }),
    StudentFeeAssignment.exists({ feeStructureId, schoolId }),
  ]);

  let billExists = false;
  if (!studentFeeExists && !assignmentExists) {
    const [studentFeeIds, assignmentIds] = await Promise.all([
      StudentFee.find({ feeStructureId, schoolId }).distinct('_id'),
      StudentFeeAssignment.find({ feeStructureId, schoolId }).distinct('_id'),
    ]);

    if (studentFeeIds.length > 0 || assignmentIds.length > 0) {
      billExists = await Bill.exists({
        schoolId,
        $or: [
          {
            sourceType: 'StudentFee',
            sourceId: { $in: studentFeeIds },
          },
          {
            sourceType: 'StudentFeeAssignment',
            sourceId: { $in: assignmentIds },
          },
        ],
      });
    }
  }

  return Boolean(studentFeeExists || assignmentExists || billExists);
};

const createFeeStructure = async (req, res) => {
  try {
    const { name, amount, frequency, classId, isOptional, status } = req.body;
    const { schoolId, _id: createdBy } = req.user;

    // Validate classId belongs to same school
    const classDoc = await Class.findOne({ _id: classId, schoolId });
    if (!classDoc) {
      return res.status(400).json({ message: 'Invalid classId' });
    }

    // Get active session for school
    const activeSession = await AcademicSession.findOne({ schoolId, isActive: true });
    if (!activeSession) {
      return res.status(400).json({ message: 'No active academic session found for this school' });
    }

    const sessionId = activeSession._id;
    const normalizedStatus = normalizeStatus(status);

    if (normalizedStatus === 'ACTIVE' && isTuitionStructure({ isOptional })) {
      const conflict = await activeTuitionExists({ schoolId, classId, sessionId });
      if (conflict) {
        return res.status(409).json({
          message:
            'Only one ACTIVE tuition fee structure is allowed per class in this session. Deactivate the existing one first.',
        });
      }
    }

    const feeStructure = await FeeStructure.create({
      name,
      amount,
      frequency,
      classId,
      sessionId,
      schoolId,
      isOptional,
      status: normalizedStatus,
      createdBy,
    });

    res.status(201).json(feeStructure);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Fee structure already exists for this class, name, and session.' });
    }
    res.status(500).json({ message: err.message });
  }
};

const getFeeStructures = async (req, res) => {
  try {
    const { classId } = req.query;
    const { schoolId } = req.user;

    const filter = { schoolId, ...getSessionFilter(req) };
    if (classId) filter.classId = classId;

    const feeStructures = await FeeStructure.find(filter)
      .populate('classId', 'name')
      .populate('sessionId', 'name')
      .sort({ createdAt: -1 })
      .lean();

    const usageCountMap = await mapUsageCounts(feeStructures, schoolId);
    const payload = feeStructures.map((fs) => ({
      ...fs,
      studentsAssigned: Number(usageCountMap.get(fs._id.toString()) || 0),
    }));

    res.json(payload);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getFeeStructureById = async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolId } = req.user;

    const feeStructure = await FeeStructure.findOne({ _id: id, schoolId })
      .populate('classId', 'name')
      .populate('sessionId', 'name')
      .lean();

    if (!feeStructure) {
      return res.status(404).json({ message: 'Fee structure not found' });
    }

    const usageCountMap = await mapUsageCounts([feeStructure], schoolId);
    return res.json({
      ...feeStructure,
      studentsAssigned: Number(usageCountMap.get(feeStructure._id.toString()) || 0),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const updateFeeStructure = async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolId } = req.user;
    const feeStructure = await FeeStructure.findOne({ _id: id, schoolId });

    if (!feeStructure) {
      return res.status(404).json({ message: 'Fee structure not found' });
    }

    const nextStatus = normalizeStatus(req.body.status ?? feeStructure.status);
    const nextIsOptional = req.body.isOptional ?? feeStructure.isOptional;

    if (nextStatus === 'ACTIVE' && isTuitionStructure({ isOptional: nextIsOptional })) {
      const conflict = await activeTuitionExists({
        schoolId,
        classId: feeStructure.classId,
        sessionId: feeStructure.sessionId,
        excludeId: feeStructure._id,
      });
      if (conflict) {
        return res.status(409).json({
          message:
            'Only one ACTIVE tuition fee structure is allowed per class in this session. Deactivate the existing one first.',
        });
      }
    }

    const allowedUpdates = ['name', 'amount', 'frequency', 'status', 'isOptional'];
    for (const key of allowedUpdates) {
      if (req.body[key] === undefined) continue;
      if (key === 'status') {
        feeStructure.status = normalizeStatus(req.body.status);
      } else {
        feeStructure[key] = req.body[key];
      }
    }

    await feeStructure.save();

    const updated = await FeeStructure.findById(feeStructure._id)
      .populate('classId', 'name')
      .populate('sessionId', 'name')
      .lean();

    const usageCountMap = await mapUsageCounts([updated], schoolId);
    return res.json({
      ...updated,
      studentsAssigned: Number(usageCountMap.get(updated._id.toString()) || 0),
      note: 'Changes apply only to future assignments and do not modify historical bills.',
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const setFeeStructureStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const { schoolId } = req.user;

    const feeStructure = await FeeStructure.findOne({ _id: id, schoolId });
    if (!feeStructure) {
      return res.status(404).json({ message: 'Fee structure not found' });
    }

    const normalizedStatus = normalizeStatus(status);
    if (normalizedStatus === 'ACTIVE' && isTuitionStructure({ isOptional: feeStructure.isOptional })) {
      const conflict = await activeTuitionExists({
        schoolId,
        classId: feeStructure.classId,
        sessionId: feeStructure.sessionId,
        excludeId: feeStructure._id,
      });
      if (conflict) {
        return res.status(409).json({
          message:
            'Only one ACTIVE tuition fee structure is allowed per class in this session. Deactivate the existing one first.',
        });
      }
    }

    feeStructure.status = normalizedStatus;
    await feeStructure.save();

    return res.json({ success: true, message: `Fee structure ${normalizedStatus.toLowerCase()} successfully` });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const duplicateFeeStructure = async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolId, _id: createdBy } = req.user;

    const source = await FeeStructure.findOne({ _id: id, schoolId }).lean();
    if (!source) {
      return res.status(404).json({ message: 'Fee structure not found' });
    }

    const duplicated = await FeeStructure.create({
      name: `${source.name} (Copy)`,
      amount: source.amount,
      frequency: source.frequency,
      classId: source.classId,
      sessionId: source.sessionId || (await resolveActiveSessionId(schoolId)),
      schoolId,
      isOptional: source.isOptional,
      status: 'INACTIVE',
      createdBy,
    });

    return res.status(201).json({ success: true, data: duplicated });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Duplicate name conflict. Rename and try again.' });
    }
    return res.status(500).json({ message: err.message });
  }
};

const deleteFeeStructure = async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolId } = req.user;

    const feeStructure = await FeeStructure.findOne({ _id: id, schoolId }).select('_id');
    if (!feeStructure) {
      return res.status(404).json({ message: 'Fee structure not found' });
    }

    const inUse = await isFeeStructureInUse({ feeStructureId: feeStructure._id, schoolId });
    if (inUse) {
      return res.status(409).json({
        message: 'This fee structure is already in use and cannot be deleted.',
      });
    }

    await FeeStructure.deleteOne({ _id: feeStructure._id, schoolId });
    return res.json({ success: true, message: 'Fee structure deleted successfully' });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  createFeeStructure,
  getFeeStructures,
  getFeeStructureById,
  updateFeeStructure,
  setFeeStructureStatus,
  duplicateFeeStructure,
  deleteFeeStructure,
};
