const { USER_ROLES } = require('../config/constants');
const Student = require('../models/Student');
const User = require('../models/User');
const StudentDailyAttendance = require('../models/StudentDailyAttendance');
const TeacherAttendance = require('../models/TeacherAttendance');
const FeePayment = require('../models/FeePayment');
const SalaryPayment = require('../models/SalaryPayment');
const SalaryProfile = require('../models/SalaryProfile');
const Exam = require('../models/Exam');
const Result = require('../models/Result');
const StudentFee = require('../models/StudentFee');
const StudentTransport = require('../models/StudentTransport');
const StudentHostel = require('../models/StudentHostel');
const Room = require('../models/Room');
const Vehicle = require('../models/Vehicle');

// Helper function to check role-based access
const checkAccess = (role) => {
  if (role === USER_ROLES.STUDENT || role === USER_ROLES.PARENT) {
    return false;
  }
  return true;
};

// 1. DASHBOARD SUMMARY
const getDashboardSummary = async (req, res) => {
  try {
    const { schoolId, role } = req.user;

    if (!checkAccess(role)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Get today's date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get current month for salary
    const currentMonth = today.toISOString().slice(0, 7); // YYYY-MM

    // Parallel aggregation queries
    const [
      studentStats,
      teacherCount,
      attendanceToday,
      feeStats,
      salaryStats
    ] = await Promise.all([
      // Student stats
      Student.aggregate([
        { $match: { schoolId } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]),

      // Teacher count
      User.countDocuments({ schoolId, role: USER_ROLES.TEACHER }),

      // Attendance today
      Promise.all([
        StudentDailyAttendance.aggregate([
          {
            $match: {
              schoolId,
              date: { $gte: today, $lt: tomorrow }
            }
          },
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 }
            }
          }
        ]),
        TeacherAttendance.aggregate([
          {
            $match: {
              schoolId,
              date: { $gte: today, $lt: tomorrow },
              status: 'PRESENT'
            }
          },
          {
            $count: 'present'
          }
        ])
      ]),

      // Fee stats
      Promise.all([
        FeePayment.aggregate([
          { $match: { schoolId } },
          {
            $group: {
              _id: null,
              totalCollected: { $sum: '$amount' }
            }
          }
        ]),
        StudentFee.aggregate([
          { $match: { schoolId, dueAmount: { $gt: 0 } } },
          {
            $group: {
              _id: null,
              totalPending: { $sum: '$dueAmount' }
            }
          }
        ])
      ]),

      // Salary stats for current month
      Promise.all([
        SalaryPayment.aggregate([
          { $match: { schoolId, month: currentMonth } },
          {
            $group: {
              _id: null,
              totalPaid: { $sum: '$amountPaid' }
            }
          }
        ]),
        // Calculate total expected salary from salary profiles
        SalaryProfile.aggregate([
          { $match: { schoolId } },
          {
            $project: {
              monthlySalary: {
                $add: [
                  '$baseSalary',
                  { $sum: '$allowances.amount' },
                  { $multiply: [{ $sum: '$deductions.amount' }, -1] }
                ]
              }
            }
          },
          {
            $group: {
              _id: null,
              totalExpected: { $sum: '$monthlySalary' }
            }
          }
        ])
      ])
    ]);

    // Process student stats
    const studentMap = {};
    studentStats.forEach(stat => {
      studentMap[stat._id] = stat.count;
    });

    // Process attendance
    const [studentAttendance, teacherAttendance] = attendanceToday;
    const attendanceMap = {};
    studentAttendance.forEach(att => {
      attendanceMap[att._id] = att.count;
    });

    // Process fees
    const [collected, pending] = feeStats;

    // Process salary
    const [paidThisMonth, expectedSalary] = salaryStats;
    const totalExpected = expectedSalary[0]?.totalExpected || 0;
    const totalPaid = paidThisMonth[0]?.totalPaid || 0;
    const pendingSalary = Math.max(0, totalExpected - totalPaid);

    const response = {
      students: {
        total: (studentMap.ACTIVE || 0) + (studentMap.PROMOTED || 0) + (studentMap.LEFT || 0),
        active: (studentMap.ACTIVE || 0) + (studentMap.PROMOTED || 0),
        inactive: studentMap.LEFT || 0
      },
      teachers: teacherCount,
      attendanceToday: {
        studentsPresent: attendanceMap.PRESENT || 0,
        studentsAbsent: attendanceMap.ABSENT || 0,
        teachersPresent: teacherAttendance[0]?.present || 0
      },
      fees: {
        totalCollected: collected[0]?.totalCollected || 0,
        pending: pending[0]?.totalPending || 0
      },
      salary: {
        paidThisMonth: totalPaid,
        pending: pendingSalary
      }
    };

    res.json(response);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 2. STUDENT STRENGTH REPORT
const getStudentStrengthReport = async (req, res) => {
  try {
    const { schoolId, role } = req.user;
    const { classId, sectionId, status } = req.query;

    if (!checkAccess(role)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    let matchConditions = { schoolId };
    if (classId) matchConditions.classId = require('mongoose').Types.ObjectId(classId);
    if (sectionId) matchConditions.sectionId = require('mongoose').Types.ObjectId(sectionId);
    if (status) matchConditions.status = status;

    const [stats, byClass] = await Promise.all([
      Student.aggregate([
        { $match: matchConditions },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            male: {
              $sum: { $cond: [{ $eq: ['$gender', 'Male'] }, 1, 0] }
            },
            female: {
              $sum: { $cond: [{ $eq: ['$gender', 'Female'] }, 1, 0] }
            }
          }
        }
      ]),
      Student.aggregate([
        { $match: matchConditions },
        {
          $lookup: {
            from: 'classes',
            localField: 'classId',
            foreignField: '_id',
            as: 'classInfo'
          }
        },
        {
          $unwind: '$classInfo'
        },
        {
          $group: {
            _id: '$classInfo.name',
            count: { $sum: 1 }
          }
        },
        {
          $project: {
            class: '$_id',
            count: 1,
            _id: 0
          }
        },
        { $sort: { class: 1 } }
      ])
    ]);

    const result = stats[0] || { total: 0, male: 0, female: 0 };

    res.json({
      total: result.total,
      male: result.male,
      female: result.female,
      byClass
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 3. ATTENDANCE ANALYTICS
const getDailyAttendanceReport = async (req, res) => {
  try {
    const { schoolId, role } = req.user;
    const { date } = req.query;

    if (!checkAccess(role)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const queryDate = new Date(date);
    queryDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(queryDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const attendance = await StudentDailyAttendance.aggregate([
      {
        $match: {
          schoolId,
          date: { $gte: queryDate, $lt: nextDay }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const result = {
      date,
      present: 0,
      absent: 0
    };

    attendance.forEach(att => {
      if (att._id === 'PRESENT') result.present = att.count;
      if (att._id === 'ABSENT') result.absent = att.count;
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getMonthlyAttendanceReport = async (req, res) => {
  try {
    const { schoolId, role } = req.user;
    const { month } = req.query;

    if (!checkAccess(role)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const [year, mon] = month.split('-');
    const startDate = new Date(year, mon - 1, 1);
    const endDate = new Date(year, mon, 1);

    // Get all attendance for the month, excluding Sundays
    const attendanceData = await StudentDailyAttendance.aggregate([
      {
        $match: {
          schoolId,
          date: { $gte: startDate, $lt: endDate },
          $expr: { $ne: [{ $dayOfWeek: '$date' }, 1] } // Exclude Sundays (1 = Sunday)
        }
      },
      {
        $lookup: {
          from: 'students',
          localField: 'studentId',
          foreignField: '_id',
          as: 'student'
        }
      },
      {
        $unwind: '$student'
      },
      {
        $lookup: {
          from: 'users',
          localField: 'student.userId',
          foreignField: '_id',
          as: 'user'
        }
      },
      {
        $unwind: '$user'
      },
      {
        $group: {
          _id: '$studentId',
          studentName: { $first: '$user.name' },
          totalDays: { $sum: 1 },
          presentDays: {
            $sum: { $cond: [{ $eq: ['$status', 'PRESENT'] }, 1, 0] }
          }
        }
      },
      {
        $project: {
          studentName: 1,
          percentage: {
            $multiply: [
              { $divide: ['$presentDays', '$totalDays'] },
              100
            ]
          }
        }
      },
      { $sort: { percentage: 1 } }
    ]);

    const totalStudents = attendanceData.length;
    const totalPercentage = attendanceData.reduce((sum, student) => sum + student.percentage, 0);
    const averageAttendance = totalStudents > 0 ? (totalPercentage / totalStudents).toFixed(1) : 0;

    const lowAttendanceStudents = attendanceData
      .filter(student => student.percentage < 75)
      .slice(0, 10)
      .map(student => ({
        name: student.studentName,
        percentage: Math.round(student.percentage)
      }));

    res.json({
      month,
      averageAttendance: parseFloat(averageAttendance),
      lowAttendanceStudents
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 4. FEES REPORTS
const getFeesSummaryReport = async (req, res) => {
  try {
    const { schoolId, role } = req.user;

    if (!checkAccess(role)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const [expected, collected] = await Promise.all([
      StudentFee.aggregate([
        { $match: { schoolId } },
        {
          $group: {
            _id: null,
            expected: { $sum: '$totalAmount' }
          }
        }
      ]),
      FeePayment.aggregate([
        { $match: { schoolId } },
        {
          $group: {
            _id: null,
            collected: { $sum: '$amount' }
          }
        }
      ])
    ]);

    const expectedAmount = expected[0]?.expected || 0;
    const collectedAmount = collected[0]?.collected || 0;
    const pendingAmount = expectedAmount - collectedAmount;

    res.json({
      expected: expectedAmount,
      collected: collectedAmount,
      pending: pendingAmount > 0 ? pendingAmount : 0
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getFeesMonthlyReport = async (req, res) => {
  try {
    const { schoolId, role } = req.user;
    const { month } = req.query;

    if (!checkAccess(role)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const [year, mon] = month.split('-');
    const startDate = new Date(year, mon - 1, 1);
    const endDate = new Date(year, mon, 1);

    const [expected, collected] = await Promise.all([
      StudentFee.aggregate([
        { $match: { schoolId } },
        {
          $group: {
            _id: null,
            expected: { $sum: '$totalAmount' }
          }
        }
      ]),
      FeePayment.aggregate([
        {
          $match: {
            schoolId,
            date: { $gte: startDate, $lt: endDate }
          }
        },
        {
          $group: {
            _id: null,
            collected: { $sum: '$amount' }
          }
        }
      ])
    ]);

    const expectedAmount = expected[0]?.expected || 0;
    const collectedAmount = collected[0]?.collected || 0;
    const pendingAmount = expectedAmount - collectedAmount;

    res.json({
      month,
      expected: expectedAmount,
      collected: collectedAmount,
      pending: pendingAmount > 0 ? pendingAmount : 0
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getFeesPendingReport = async (req, res) => {
  try {
    const { schoolId, role } = req.user;

    if (!checkAccess(role)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const pendingFees = await StudentFee.aggregate([
      {
        $match: {
          schoolId,
          dueAmount: { $gt: 0 }
        }
      },
      {
        $lookup: {
          from: 'students',
          localField: 'studentId',
          foreignField: '_id',
          as: 'student'
        }
      },
      {
        $unwind: '$student'
      },
      {
        $lookup: {
          from: 'users',
          localField: 'student.userId',
          foreignField: '_id',
          as: 'user'
        }
      },
      {
        $unwind: '$user'
      },
      {
        $lookup: {
          from: 'classes',
          localField: 'student.classId',
          foreignField: '_id',
          as: 'class'
        }
      },
      {
        $unwind: '$class'
      },
      {
        $project: {
          studentId: '$student._id',
          studentName: '$user.name',
          rollNumber: '$student.rollNumber',
          class: '$class.name',
          dueAmount: 1
        }
      },
      { $sort: { dueAmount: -1 } }
    ]);

    const totalPending = pendingFees.reduce((sum, fee) => sum + fee.dueAmount, 0);

    res.json({
      totalPending,
      pendingStudents: pendingFees
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 5. EXAM & PERFORMANCE REPORTS
const getExamsSummaryReport = async (req, res) => {
  try {
    const { schoolId, role } = req.user;

    if (!checkAccess(role)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const results = await Result.aggregate([
      { $match: { schoolId } },
      {
        $group: {
          _id: null,
          totalStudents: { $sum: 1 },
          totalPercentage: { $sum: '$percentage' },
          passedStudents: {
            $sum: { $cond: [{ $eq: ['$overallStatus', 'PASS'] }, 1, 0] }
          }
        }
      }
    ]);

    if (results.length === 0) {
      return res.json({
        averagePercentage: 0,
        passPercentage: 0,
        totalExams: 0
      });
    }

    const data = results[0];
    const averagePercentage = (data.totalPercentage / data.totalStudents).toFixed(1);
    const passPercentage = ((data.passedStudents / data.totalStudents) * 100).toFixed(1);

    res.json({
      averagePercentage: parseFloat(averagePercentage),
      passPercentage: parseFloat(passPercentage),
      totalResults: data.totalStudents
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getExamTopperReport = async (req, res) => {
  try {
    const { schoolId, role } = req.user;
    const { examId } = req.query;

    if (!checkAccess(role)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const exam = await Exam.findById(examId);
    if (!exam) {
      return res.status(404).json({ message: 'Exam not found' });
    }

    const toppers = await Result.aggregate([
      { $match: { examId, schoolId } },
      {
        $lookup: {
          from: 'students',
          localField: 'studentId',
          foreignField: '_id',
          as: 'student'
        }
      },
      {
        $unwind: '$student'
      },
      {
        $lookup: {
          from: 'users',
          localField: 'student.userId',
          foreignField: '_id',
          as: 'user'
        }
      },
      {
        $unwind: '$user'
      },
      {
        $project: {
          name: '$user.name',
          percentage: 1,
          grade: 1
        }
      },
      { $sort: { percentage: -1 } },
      { $limit: 10 }
    ]);

    res.json({
      exam: exam.name,
      toppers: toppers.map(topper => ({
        name: topper.name,
        percentage: topper.percentage,
        grade: topper.grade
      }))
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 6. SALARY & PAYROLL REPORTS
const getSalaryMonthlyReport = async (req, res) => {
  try {
    const { schoolId, role } = req.user;
    const { month } = req.query;

    if (!checkAccess(role)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const payments = await SalaryPayment.aggregate([
      { $match: { schoolId, month } },
      {
        $group: {
          _id: null,
          totalPaid: { $sum: '$amountPaid' },
          staffCount: { $addToSet: '$staffId' }
        }
      },
      {
        $project: {
          totalPaid: 1,
          staffCount: { $size: '$staffCount' }
        }
      }
    ]);

    // For pending, we'd need to calculate from salary profiles
    // This is simplified
    const result = payments[0] || { totalPaid: 0, staffCount: 0 };

    res.json({
      month,
      totalPaid: result.totalPaid,
      totalPending: 0, // Would need salary calculation logic
      staffCount: result.staffCount
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getStaffSalaryReport = async (req, res) => {
  try {
    const { schoolId, role } = req.user;
    const { id: staffId } = req.params;

    if (!checkAccess(role)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const payments = await SalaryPayment.find({
      schoolId,
      staffId
    }).sort({ month: -1 });

    const totalPaid = payments.reduce((sum, payment) => sum + payment.amountPaid, 0);

    res.json({
      staffId,
      totalPaid,
      payments: payments.map(p => ({
        month: p.month,
        amountPaid: p.amountPaid,
        paymentDate: p.paymentDate
      }))
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 7. TRANSPORT & HOSTEL REPORTS
const getTransportReport = async (req, res) => {
  try {
    const { schoolId, role } = req.user;

    if (!checkAccess(role)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const [vehicles, students] = await Promise.all([
      Vehicle.countDocuments({ schoolId }),
      StudentTransport.countDocuments({ schoolId, status: 'ACTIVE' })
    ]);

    res.json({
      vehicles,
      studentsUsingTransport: students
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getHostelReport = async (req, res) => {
  try {
    const { schoolId, role } = req.user;

    if (!checkAccess(role)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const [hostels, occupiedBeds] = await Promise.all([
      Room.distinct('hostelId', { schoolId }),
      StudentHostel.countDocuments({ schoolId, status: 'ACTIVE' })
    ]);

    // Calculate total capacity
    const totalCapacity = await Room.aggregate([
      { $match: { schoolId } },
      {
        $group: {
          _id: null,
          totalCapacity: { $sum: '$capacity' }
        }
      }
    ]);

    const availableBeds = (totalCapacity[0]?.totalCapacity || 0) - occupiedBeds;

    res.json({
      hostels: hostels.length,
      occupiedBeds,
      availableBeds: availableBeds > 0 ? availableBeds : 0
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getDashboardSummary,
  getStudentStrengthReport,
  getDailyAttendanceReport,
  getMonthlyAttendanceReport,
  getFeesSummaryReport,
  getFeesMonthlyReport,
  getFeesPendingReport,
  getExamsSummaryReport,
  getExamTopperReport,
  getSalaryMonthlyReport,
  getStaffSalaryReport,
  getTransportReport,
  getHostelReport
};
