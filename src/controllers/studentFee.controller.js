const StudentFee = require('../models/StudentFee');
const Student = require('../models/Student');
const FeeStructure = require('../models/FeeStructure');
const AcademicSession = require('../models/AcademicSession');

const assignFee = async (req, res) => {
  try {
    const { studentId, feeStructureId } = req.body;
    const { schoolId, _id: assignedBy } = req.user;

    // Validate student belongs to same school
    const student = await Student.findOne({ _id: studentId, schoolId });
    if (!student) {
      return res.status(400).json({ message: 'Invalid studentId' });
    }

    // Validate feeStructure belongs to same school
    const feeStructure = await FeeStructure.findOne({ _id: feeStructureId, schoolId });
    if (!feeStructure) {
      return res.status(400).json({ message: 'Invalid feeStructureId' });
    }

    // Get active session for school
    const activeSession = await AcademicSession.findOne({ schoolId, isActive: true });
    if (!activeSession) {
      return res.status(400).json({ message: 'No active academic session found for this school' });
    }

    const sessionId = activeSession._id;

    const totalAmount = feeStructure.amount;
    const paidAmount = 0;
    const dueAmount = totalAmount;
    const status = 'Due';

    const studentFee = await StudentFee.create({
      studentId,
      feeStructureId,
      totalAmount,
      paidAmount,
      dueAmount,
      status,
      sessionId,
      schoolId,
      assignedBy,
    });

    res.status(201).json(studentFee);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Fee already assigned to this student for this fee structure and session.' });
    }
    res.status(500).json({ message: err.message });
  }
};

const getStudentFees = async (req, res) => {
  try {
    const { id: studentId } = req.params;
    const { schoolId } = req.user;

    const studentFees = await StudentFee.find({ studentId, schoolId })
      .populate('feeStructureId', 'name amount frequency')
      .populate('studentId', 'name rollNumber')
      .sort({ createdAt: -1 });

    res.json(studentFees);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  assignFee,
  getStudentFees,
};
