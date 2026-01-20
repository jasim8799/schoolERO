const AcademicHistory = require('../models/AcademicHistory.js');
const Student = require('../models/Student.js');
const Parent = require('../models/Parent.js');

const getStudentAcademicHistory = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { schoolId, role, _id: userId } = req.user;

    let allowedStudentIds = [];

    if (role === 'STUDENT') {
      // Map userId to studentId
      const student = await Student.findOne({ userId, schoolId });
      if (!student) {
        return res.status(404).json({ message: 'Student profile not found' });
      }
      allowedStudentIds = [student._id.toString()];
    } else if (role === 'PARENT') {
      // Get children
      const parent = await Parent.findOne({ userId, schoolId });
      if (!parent) {
        return res.status(404).json({ message: 'Parent profile not found' });
      }
      const children = await Student.find({ parentId: parent._id, schoolId }).select('_id');
      allowedStudentIds = children.map(c => c._id.toString());
    } else {
      // Other roles can access any
      allowedStudentIds = [studentId];
    }

    if (!allowedStudentIds.includes(studentId)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const history = await AcademicHistory.find({ studentId, schoolId }).sort({ sessionId: 1 });
    res.json(history);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getStudentAcademicHistory
};
