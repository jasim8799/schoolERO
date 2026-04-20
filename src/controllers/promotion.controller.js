const Student = require('../models/Student.js');
const AcademicHistory = require('../models/AcademicHistory.js');
const Result = require('../models/Result.js');
const Class = require('../models/Class.js');
const Bill = require('../models/Bill.js');

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

    const targetClassCount = await Class.countDocuments({
      schoolId,
      sessionId: toSessionId,
      status: 'active'
    });
    if (targetClassCount === 0) {
      return res.status(400).json({
        message: 'Target session has no classes. Run session setup first.'
      });
    }

    const students = await Student.find({
      classId,
      sessionId: fromSessionId,
      status: 'ACTIVE',
      schoolId
    }).select('name rollNumber classId sectionId');

    const dueList = await Bill.find({
      schoolId,
      sessionId: fromSessionId,
      studentId: { $in: students.map((s) => s._id) },
      status: { $in: ['UNPAID', 'PARTIAL'] },
      dueAmount: { $gt: 0 }
    }).select('studentId');
    const dueSet = new Set(dueList.map((b) => b.studentId.toString()));

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
      const feesCleared = !dueSet.has(student._id.toString());

      if (promotionStatus === 'ELIGIBLE') {
        const nextClassId = await getNextClass(student.classId, schoolId, toSessionId);
        if (nextClassId) {
          suggestedNextClassId = nextClassId;
          action = 'PROMOTE';
        } else {
          // Eligible student in terminal class should graduate.
          action = 'GRADUATE';
        }
      }

      // Default suggestion: unpaid dues are retained (can be overridden in UI).
      if (!feesCleared && action === 'PROMOTE') {
        action = 'RETAIN';
      }

      return {
        studentId: student._id,
        name: student.name,
        rollNumber: student.rollNumber,
        currentClassId: student.classId,
        currentSectionId: student.sectionId,
        suggestedNextClassId,
        promotionStatus,
        action,
        feesCleared
      };
    }));

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const executePromotion = async (req, res) => {
  try {
    const { fromSessionId, toSessionId, promotions } = req.body;
    const { role, schoolId } = req.user;

    if (role !== 'PRINCIPAL' && role !== 'OPERATOR') {
      return res.status(403).json({ message: 'Forbidden' });
    }

    if (fromSessionId === toSessionId) {
      return res.status(400).json({ message: 'Sessions must be different' });
    }

    if (!Array.isArray(promotions) || promotions.length === 0) {
      return res.status(400).json({ message: 'Promotions list is required' });
    }

    const targetClassCount = await Class.countDocuments({
      schoolId,
      sessionId: toSessionId,
      status: 'active'
    });
    if (targetClassCount === 0) {
      return res.status(400).json({
        message: 'Target session has no classes. Run session setup first.'
      });
    }

    const results = { promoted: 0, retained: 0, graduated: 0, errors: [] };

    for (const promo of promotions) {
      try {
        const student = await Student.findById(promo.studentId);
        if (
          !student ||
          student.schoolId.toString() !== schoolId ||
          student.sessionId.toString() !== fromSessionId
        ) {
          results.errors.push(`Student ${promo.studentId} not found`);
          continue;
        }

        await AcademicHistory.updateOne(
          {
            studentId: promo.studentId,
            sessionId: fromSessionId,
            schoolId: student.schoolId
          },
          {
            $set: {
              fromSessionId,
              sessionId: fromSessionId,
              classId: student.classId,
              sectionId: student.sectionId,
              rollNumber: student.rollNumber,
              status: promo.action === 'PROMOTE'
                ? 'Promoted'
                : promo.action === 'GRADUATE'
                    ? 'Graduated'
                    : 'Retained'
            }
          },
          { upsert: true }
        );

        if (promo.action === 'GRADUATE') {
          await Student.findByIdAndUpdate(promo.studentId, {
            status: 'GRADUATED'
          });
          results.graduated++;
        } else if (promo.action === 'PROMOTE') {
          const nextClassId = await getNextClass(
            student.classId,
            student.schoolId,
            toSessionId
          );

          if (!nextClassId) {
            await Student.findByIdAndUpdate(promo.studentId, {
              status: 'GRADUATED'
            });
            results.graduated++;
          } else {
            await Student.findByIdAndUpdate(promo.studentId, {
              classId: nextClassId,
              sessionId: toSessionId,
              sectionId: null,
              status: 'ACTIVE'
            });
            results.promoted++;
          }
        } else {
          const currentClass = await Class.findById(student.classId);
          const retainedClass = await Class.findOne({
            schoolId: student.schoolId,
            sessionId: toSessionId,
            order: currentClass?.order,
            status: 'active'
          });

          await Student.findByIdAndUpdate(promo.studentId, {
            classId: retainedClass?._id ?? student.classId,
            sessionId: toSessionId,
            sectionId: null,
            status: 'ACTIVE'
          });
          results.retained++;
        }
      } catch (studentErr) {
        results.errors.push(`Error for ${promo.studentId}: ${studentErr.message}`);
      }
    }

    res.json({
      success: true,
      message: `Promotion complete: ${results.promoted} promoted, ${results.retained} retained, ${results.graduated} graduated`,
      data: results
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const executeAllPromotion = async (req, res) => {
  try {
    const { fromSessionId, toSessionId } = req.body;
    const { role, schoolId } = req.user;

    if (role !== 'PRINCIPAL' && role !== 'OPERATOR') {
      return res.status(403).json({ message: 'Forbidden' });
    }

    if (fromSessionId === toSessionId) {
      return res.status(400).json({ message: 'Sessions must be different' });
    }

    const targetClassCount = await Class.countDocuments({
      schoolId,
      sessionId: toSessionId,
      status: 'active'
    });
    if (targetClassCount === 0) {
      return res.status(400).json({
        message: 'Target session has no classes. Run session setup first.'
      });
    }

    const classes = await Class.find({
      sessionId: fromSessionId,
      schoolId,
      status: 'active'
    });

    const results = { promoted: 0, retained: 0, graduated: 0, errors: [] };

    for (const cls of classes) {
      const students = await Student.find({
        classId: cls._id,
        sessionId: fromSessionId,
        status: 'ACTIVE',
        schoolId
      });

      for (const student of students) {
        try {
          const nextClassId = await getNextClass(student.classId, schoolId, toSessionId);
          const action = nextClassId ? 'PROMOTE' : 'GRADUATE';

          await AcademicHistory.updateOne(
            {
              studentId: student._id,
              sessionId: fromSessionId,
              schoolId
            },
            {
              $set: {
                fromSessionId,
                sessionId: fromSessionId,
                classId: student.classId,
                sectionId: student.sectionId,
                rollNumber: student.rollNumber,
                status: action === 'PROMOTE' ? 'Promoted' : 'Graduated'
              }
            },
            { upsert: true }
          );

          if (action === 'GRADUATE') {
            await Student.findByIdAndUpdate(student._id, { status: 'GRADUATED' });
            results.graduated++;
          } else {
            await Student.findByIdAndUpdate(student._id, {
              classId: nextClassId,
              sessionId: toSessionId,
              sectionId: null,
              status: 'ACTIVE'
            });
            results.promoted++;
          }
        } catch (studentErr) {
          results.errors.push(`Error for ${student._id}: ${studentErr.message}`);
        }
      }
    }

    res.json({ success: true, message: 'All classes promoted', data: results });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  previewPromotion,
  executePromotion,
  executeAllPromotion
};
