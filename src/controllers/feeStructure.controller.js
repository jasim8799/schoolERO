const FeeStructure = require('../models/FeeStructure');
const Class = require('../models/Class');
const AcademicSession = require('../models/AcademicSession');

const createFeeStructure = async (req, res) => {
  try {
    const { name, amount, frequency, classId, isOptional, status } = req.body;
    const { sessionId, schoolId, _id: createdBy } = req.user;

    // Validate classId belongs to same school
    const classDoc = await Class.findOne({ _id: classId, schoolId });
    if (!classDoc) {
      return res.status(400).json({ message: 'Invalid classId' });
    }

    // Validate sessionId is active for school
    const sessionDoc = await AcademicSession.findOne({ _id: sessionId, schoolId, status: 'ACTIVE' });
    if (!sessionDoc) {
      return res.status(400).json({ message: 'Invalid sessionId' });
    }

    const feeStructure = await FeeStructure.create({
      name,
      amount,
      frequency,
      classId,
      sessionId,
      schoolId,
      isOptional,
      status,
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

    const filter = { schoolId };
    if (classId) filter.classId = classId;

    const feeStructures = await FeeStructure.find(filter).populate('classId', 'name');
    res.json(feeStructures);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  createFeeStructure,
  getFeeStructures,
};
