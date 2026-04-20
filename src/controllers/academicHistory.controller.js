const AcademicHistory = require('../models/AcademicHistory.js');
const Student = require('../models/Student.js');
const Parent = require('../models/Parent.js');
const AcademicSession = require('../models/AcademicSession.js');
const StudentDailyAttendance = require('../models/StudentDailyAttendance.js');
const Result = require('../models/Result.js');
const Exam = require('../models/Exam.js');
const Bill = require('../models/Bill.js');

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

    const history = await AcademicHistory.find({ studentId, schoolId })
      .populate('sessionId', 'name startDate endDate')
      .populate('classId', 'name order')
      .populate('sectionId', 'name')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: history });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getStudentSessionSummary = async (req, res) => {
  try {
    const { studentId, sessionId } = req.params;
    const { schoolId, role, _id: userId } = req.user;

    let allowedStudentIds = [];

    if (role === 'STUDENT') {
      const student = await Student.findOne({ userId, schoolId });
      if (!student) {
        return res.status(404).json({ message: 'Student not found' });
      }
      allowedStudentIds = [student._id.toString()];
    } else if (role === 'PARENT') {
      const parent = await Parent.findOne({ userId, schoolId });
      if (!parent) {
        return res.status(404).json({ message: 'Parent not found' });
      }
      const children = await Student.find({ parentId: parent._id, schoolId }).select('_id');
      allowedStudentIds = children.map(c => c._id.toString());
    } else {
      allowedStudentIds = [studentId];
    }

    if (!allowedStudentIds.includes(studentId)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const session = await AcademicSession.findOne({ _id: sessionId, schoolId })
      .select('name startDate endDate isActive');
    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }

    const historyRecord = await AcademicHistory.findOne({ studentId, sessionId, schoolId })
      .populate('classId', 'name order')
      .populate('sectionId', 'name');

    const studentInSession = await Student.findOne({
      _id: studentId,
      schoolId,
    })
      .populate('classId', 'name')
      .populate('sectionId', 'name')
      .select('name rollNumber classId sectionId');

    let attendanceSummary = { totalDays: 0, presentDays: 0, percentage: 0 };
    try {
      const attendanceRecords = await StudentDailyAttendance.find({
        studentId,
        schoolId,
        sessionId,
      }).select('status');

      const total = attendanceRecords.length;
      const present = attendanceRecords.filter(a => a.status === 'PRESENT').length;
      const halfDay = attendanceRecords.filter(a => a.status === 'HALF_DAY').length;
      const effectivePresent = present + (halfDay * 0.5);

      attendanceSummary = {
        totalDays: total,
        presentDays: Math.round(effectivePresent),
        percentage: total > 0 ? Math.round((effectivePresent / total) * 100) : 0,
      };
    } catch (_) {}

    let examResults = [];
    try {
      const results = await Result.find({
        studentId,
        schoolId,
        sessionId,
        status: 'Published',
      })
        .populate('examId', 'name examType')
        .select('examId totalMarks percentage grade promotionStatus');

      examResults = results.map(r => ({
        examName: r.examId?.name || 'Exam',
        examType: r.examId?.examType || '',
        totalMarks: r.totalMarks,
        obtainedMarks: r.totalMarks,
        percentage: r.percentage,
        grade: r.grade,
        promotionStatus: r.promotionStatus,
      }));
    } catch (_) {}

    let feeSummary = {
      totalBilled: 0,
      totalPaid: 0,
      totalDue: 0,
      billCount: 0,
      fullyPaid: false,
    };
    try {
      const bills = await Bill.find({
        studentId,
        schoolId,
        sessionId,
      }).select('totalAmount paidAmount dueAmount status');

      const totalBilled = bills.reduce((sum, b) => sum + (b.totalAmount || 0), 0);
      const totalPaid = bills.reduce((sum, b) => sum + (b.paidAmount || 0), 0);
      const totalDue = bills.reduce((sum, b) => sum + (b.dueAmount || 0), 0);

      feeSummary = {
        totalBilled,
        totalPaid,
        totalDue,
        billCount: bills.length,
        fullyPaid: totalDue === 0 && bills.length > 0,
      };
    } catch (_) {}

    let examCount = 0;
    try {
      examCount = await Exam.countDocuments({
        schoolId,
        sessionId,
        status: 'Published',
      });
    } catch (_) {}

    res.json({
      success: true,
      data: {
        session: {
          _id: session._id,
          name: session.name,
          startDate: session.startDate,
          endDate: session.endDate,
          isActive: session.isActive,
        },
        studentInfo: {
          name: studentInSession?.name,
          rollNumber: historyRecord?.rollNumber || studentInSession?.rollNumber,
          className: historyRecord?.classId?.name || studentInSession?.classId?.name,
          sectionName: historyRecord?.sectionId?.name || studentInSession?.sectionId?.name,
          promotionStatus: historyRecord?.status || 'Current',
        },
        attendance: attendanceSummary,
        examResults,
        examCount,
        fees: feeSummary,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getStudentAcademicHistory,
  getStudentSessionSummary
};
