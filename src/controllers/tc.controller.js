const TC = require('../models/TC.js');
const Student = require('../models/Student.js');
const AcademicHistory = require('../models/AcademicHistory.js');
const Parent = require('../models/Parent.js');

const issueTC = async (req, res) => {
  try {
    const { studentId, reason, issueDate } = req.body;
    const { role, schoolId } = req.user;

    if (role !== 'PRINCIPAL' && role !== 'OPERATOR') {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const student = await Student.findOne({ _id: studentId, schoolId });
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    if (student.status !== 'ACTIVE') {
      return res.status(400).json({ message: 'Student is not active' });
    }

    // Generate unique tcNumber school-wise
    const count = await TC.countDocuments({ schoolId });
    const tcNumber = `TC-${schoolId}-${count + 1}`;

    const tc = await TC.create({
      studentId,
      lastClassId: student.classId,
      reason,
      issueDate,
      tcNumber,
      schoolId
    });

    await Student.findByIdAndUpdate(studentId, { status: 'LEFT' });

    await AcademicHistory.create({
      studentId,
      sessionId: student.sessionId,
      classId: student.classId,
      sectionId: student.sectionId,
      rollNumber: student.rollNumber,
      status: 'Left',
      schoolId
    });

    res.status(201).json(tc);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getStudentTC = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { schoolId, role, studentId: loggedStudentId } = req.user;

    if (role === 'STUDENT') {
      const student = await Student.findOne({ userId: req.user._id, schoolId });
      if (!student || student._id.toString() !== studentId) {
        return res.status(403).json({ message: 'Access denied' });
      }
    } else if (role === 'PARENT') {
      const parent = await Parent.findOne({ userId: req.user._id, schoolId });
      if (!parent || !parent.children.includes(studentId)) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }
    // For PRINCIPAL/OPERATOR, no restriction

    const tc = await TC.findOne({ studentId, schoolId });
    if (!tc) {
      return res.status(404).json({ message: 'TC not found' });
    }

    res.json(tc);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { issueTC, getStudentTC };
