import Student from '../models/Student.js';
import AcademicHistory from '../models/AcademicHistory.js';

export const previewPromotion = async (req, res) => {
  try {
    const { fromSessionId, toSessionId, classId } = req.body;

    if (fromSessionId === toSessionId) {
      return res.status(400).json({ message: 'Sessions must be different' });
    }

    const students = await Student.find({ classId, sessionId: fromSessionId, status: 'ACTIVE' }).select('name rollNumber classId');
    const result = students.map(student => ({
      studentId: student._id,
      name: student.name,
      rollNumber: student.rollNumber,
      currentClassId: student.classId,
      suggestedNextClassId: student.classId + 1, // assume classId is number
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const executePromotion = async (req, res) => {
  try {
    const { fromSessionId, toSessionId, promotions } = req.body;
    const { role } = req.user;

    if (role !== 'PRINCIPAL' && role !== 'OPERATOR') {
      return res.status(403).json({ message: 'Forbidden' });
    }

    for (const promo of promotions) {
      const student = await Student.findById(promo.studentId);
      if (!student || student.sessionId.toString() !== fromSessionId) {
        return res.status(400).json({ message: 'Invalid student' });
      }

      let newClassId = student.classId;
      let status = 'Retained';
      if (promo.action === 'PROMOTE') {
        newClassId = student.classId + 1;
        status = 'Promoted';
      }

      await Student.findByIdAndUpdate(promo.studentId, { classId: newClassId, sessionId: toSessionId });

      await AcademicHistory.create({
        studentId: promo.studentId,
        sessionId: fromSessionId,
        classId: student.classId,
        sectionId: student.sectionId,
        rollNumber: student.rollNumber,
        status,
        schoolId: student.schoolId,
      });
    }

    res.json({ message: 'Promotion executed' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
