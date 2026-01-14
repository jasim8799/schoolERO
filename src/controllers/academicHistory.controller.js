import AcademicHistory from '../models/AcademicHistory.js';

export const getStudentAcademicHistory = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { schoolId, role, studentId: loggedStudentId } = req.user;

    if (role === 'STUDENT' || role === 'PARENT') {
      if (studentId !== loggedStudentId) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    const history = await AcademicHistory.find({ studentId, schoolId }).sort({ sessionId: 1 });
    res.json(history);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
