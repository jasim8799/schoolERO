import Homework from '../models/Homework.js';
import Student from '../models/Student.js';

export const createHomework = async (req, res) => {
  try {
    const { title, description, classId, sectionId, subjectId, dueDate, attachments } = req.body;
    const { role, schoolId, sessionId, _id: createdBy } = req.user;

    if (!['TEACHER', 'PRINCIPAL', 'OPERATOR'].includes(role)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const homework = await Homework.create({
      title,
      description,
      classId,
      sectionId,
      subjectId,
      dueDate,
      attachments,
      createdBy,
      sessionId,
      schoolId
    });
    res.status(201).json(homework);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getHomeworkByClass = async (req, res) => {
  try {
    const { classId } = req.query;
    const { schoolId } = req.user;

    const homework = await Homework.find({ classId, schoolId }).sort({ dueDate: -1 });
    res.json(homework);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getHomeworkForStudent = async (req, res) => {
  try {
    const { role, studentId, schoolId, sessionId } = req.user;

    let student;
    if (role === 'STUDENT') {
      student = await Student.findById(studentId);
    } else if (role === 'PARENT') {
      student = await Student.findById(studentId);
    } else {
      return res.status(403).json({ message: 'Forbidden' });
    }

    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    const homework = await Homework.find({ classId: student.classId, sessionId, schoolId }).sort({ dueDate: -1 });
    res.json(homework);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
