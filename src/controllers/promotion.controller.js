const Student = require('../models/Student.js');
const AcademicHistory = require('../models/AcademicHistory.js');
const Result = require('../models/Result.js');
const Class = require('../models/Class.js');

// Shared helper function for consistent promotion logic
async function getNextClass(currentClassId, schoolId, toSessionId) {
  // 1. Fetch current class to get its order
  const currentClass = await Class.findById(currentClassId);
  if (!currentClass) {
    throw new Error('Current class not found');
  }

  // 2. Get all classes for the school and toSessionId, sorted by order
  const toSessionClasses = await Class.find({
    schoolId,
    sessionId: toSessionId,
    status: 'active'
  }).sort({ order: 1 }); // Sort by academic order

  // 3. Find the class in toSession with the next order
  const nextOrder = currentClass.order + 1;
  const nextClass = toSessionClasses.find(c => c.order === nextOrder);

  if (!nextClass) {
    // No next class, terminal class
    return null;
  }

  return nextClass._id;
}

const previewPromotion = async (req, res) => {
  try {
    const { fromSessionId, toSessionId, classId } = req.body;
    const { schoolId } = req.user;

    if (fromSessionId === toSessionId) {
      return res.status(400).json({ message: 'Sessions must be different' });
    }

    const students = await Student.find({ classId, sessionId: fromSessionId, status: 'ACTIVE', schoolId }).select('name rollNumber classId');

    // Get all results for these students in the fromSessionId
    const studentIds = students.map(s => s._id);
    const results = await Result.find({
      studentId: { $in: studentIds },
      sessionId: fromSessionId,
      schoolId,
      status: 'Published'
    }).select('studentId promotionStatus');

    // Create a map of studentId to promotionStatus
    const promotionMap = {};
    results.forEach(result => {
      promotionMap[result.studentId.toString()] = result.promotionStatus;
    });

    const result = await Promise.all(students.map(async (student) => {
      const promotionStatus = promotionMap[student._id.toString()] || 'NOT_ELIGIBLE';
      let suggestedNextClassId = student.classId;
      let action = 'RETAIN';

      if (promotionStatus === 'ELIGIBLE') {
        const nextClassId = await getNextClass(student.classId, schoolId, toSessionId);
        if (nextClassId) {
          suggestedNextClassId = nextClassId;
          action = 'PROMOTE';
        } else {
          // Terminal class, but still eligible? Perhaps retain or complete
          action = 'RETAIN';
        }
      }

      return {
        studentId: student._id,
        name: student.name,
        rollNumber: student.rollNumber,
        currentClassId: student.classId,
        suggestedNextClassId,
        promotionStatus,
        action
      };
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const executePromotion = async (req, res) => {
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
        const nextClassId = await getNextClass(student.classId, student.schoolId, toSessionId);
        if (nextClassId) {
          newClassId = nextClassId;
          status = 'Promoted';
        } else {
          // Terminal class
          status = 'Completed';
        }
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

module.exports = {
  previewPromotion,
  executePromotion
};
