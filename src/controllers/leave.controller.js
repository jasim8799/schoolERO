const LeaveApplication = require('../models/LeaveApplication.js');
const StudentDailyAttendance = require('../models/StudentDailyAttendance.js');
const StaffAttendance = require('../models/StaffAttendance.js');
const Student = require('../models/Student.js');
const AcademicSession = require('../models/AcademicSession.js');
const { auditLog } = require('../utils/auditLog.js');

const normalizeDate = (d) => {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  return date;
};

// Get all dates in a range (inclusive)
const getDatesInRange = (from, to) => {
  const dates = [];
  const cur = new Date(from);
  const end = new Date(to);
  while (cur <= end) {
    dates.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
};

// POST /api/leave - Apply for leave
const applyLeave = async (req, res) => {
  try {
    const { fromDate, toDate, reason, leaveType } = req.body;
    const { userId, role, schoolId } = req.user;
    const normalizedSchoolId = schoolId?._id || schoolId;

    if (!fromDate || !toDate || !reason) {
      return res.status(400).json({
        success: false,
        message: 'fromDate, toDate, and reason are required',
      });
    }

    const activeSession = await AcademicSession.findOne({
      schoolId: normalizedSchoolId,
      isActive: true,
    });
    if (!activeSession) {
      return res.status(400).json({ success: false, message: 'No active session' });
    }

    // For students, find their Student record
    let studentId = null;
    if (role === 'STUDENT') {
      const student = await Student.findOne({
        userId,
        schoolId: normalizedSchoolId,
      });
      if (!student) {
        return res.status(404).json({ success: false, message: 'Student record not found' });
      }
      studentId = student._id;
    }

    const application = await LeaveApplication.create({
      applicantId: userId,
      applicantRole: role,
      studentId,
      schoolId: normalizedSchoolId,
      sessionId: activeSession._id,
      fromDate: normalizeDate(fromDate),
      toDate: normalizeDate(toDate),
      reason,
      leaveType: leaveType || 'CASUAL_LEAVE',
    });

    return res.status(201).json({ success: true, data: application });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/leave/my - Get own applications
const getMyLeaveApplications = async (req, res) => {
  try {
    const { userId, schoolId } = req.user;
    const normalizedSchoolId = schoolId?._id || schoolId;

    const applications = await LeaveApplication.find({
      applicantId: userId,
      schoolId: normalizedSchoolId,
    })
      .populate('reviewedBy', 'name')
      .sort({ createdAt: -1 });

    return res.json({ success: true, data: applications });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/leave/all - Principal/Operator: get all pending/all applications
const getAllLeaveApplications = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { status, role: filterRole } = req.query;
    const normalizedSchoolId = schoolId?._id || schoolId;

    const filter = { schoolId: normalizedSchoolId };
    if (status) filter.status = status;
    if (filterRole) filter.applicantRole = filterRole;

    const applications = await LeaveApplication.find(filter)
      .populate('applicantId', 'name email role')
      .populate('studentId', 'name rollNumber classId')
      .populate('reviewedBy', 'name')
      .sort({ createdAt: -1 });

    return res.json({ success: true, data: applications });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/leave/:id/review - Principal approves/rejects
const reviewLeaveApplication = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reviewNote } = req.body;
    const { userId, schoolId } = req.user;
    const normalizedSchoolId = schoolId?._id || schoolId;

    if (!['APPROVED', 'REJECTED'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'status must be APPROVED or REJECTED',
      });
    }

    const application = await LeaveApplication.findOne({
      _id: id,
      schoolId: normalizedSchoolId,
    });
    if (!application) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    application.status = status;
    application.reviewedBy = userId;
    application.reviewNote = reviewNote || '';
    application.reviewedAt = new Date();
    await application.save();

    // If APPROVED -> auto-mark attendance as LEAVE for all dates in range
    if (status === 'APPROVED' && !application.attendanceMarked) {
      const activeSession = await AcademicSession.findOne({
        schoolId: normalizedSchoolId,
        isActive: true,
      });

      const dates = getDatesInRange(application.fromDate, application.toDate);

      if (application.applicantRole === 'STUDENT' && application.studentId) {
        const student = await Student.findById(application.studentId);
        if (student) {
          const bulkOps = dates.map((date) => ({
            updateOne: {
              filter: {
                studentId: application.studentId,
                date: normalizeDate(date),
                schoolId: normalizedSchoolId,
              },
              update: {
                $set: {
                  classId: student.classId,
                  sectionId: student.sectionId,
                  status: 'LEAVE',
                  markedBy: userId,
                  sessionId: activeSession?._id,
                  schoolId: normalizedSchoolId,
                },
              },
              upsert: true,
            },
          }));
          await StudentDailyAttendance.bulkWrite(bulkOps);
        }
      } else {
        // Staff leave
        const bulkOps = dates.map((date) => ({
          updateOne: {
            filter: {
              staffId: application.applicantId,
              date: normalizeDate(date),
              schoolId: normalizedSchoolId,
            },
            update: {
              $set: {
                role: application.applicantRole,
                status: 'LEAVE',
                markedBy: userId,
                sessionId: activeSession?._id,
                schoolId: normalizedSchoolId,
              },
            },
            upsert: true,
          },
        }));
        await StaffAttendance.bulkWrite(bulkOps);
      }

      application.attendanceMarked = true;
      await application.save();

      // Auto-notify parents when student leave is approved
      if (application.applicantRole === 'STUDENT' && application.studentId) {
        try {
          const Notice = require('../models/Notice.js');
          const student = await Student.findById(application.studentId)
            .populate('classId', 'name');
          if (student) {
            await Notice.create({
              schoolId: normalizedSchoolId,
              title: `Leave Approved: ${student.name}`,
              message: `Leave application for ${student.name} from ${application.fromDate.toDateString()} to ${application.toDate.toDateString()} has been approved. Reason: ${application.reason}`,
              target: 'Parents',
              classId: student.classId?._id,
              announcementType: 'Notice',
              isImportant: true,
              createdBy: userId,
            });
          }
        } catch (_) {
          // Notice creation failure should not block the response
        }
      }
    }

    await auditLog({
      action: 'LEAVE_APPLICATION_REVIEWED',
      userId: req.user.userId,
      schoolId,
      details: { applicationId: id, status, reviewNote },
      req,
    });

    return res.json({ success: true, data: application });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  applyLeave,
  getMyLeaveApplications,
  getAllLeaveApplications,
  reviewLeaveApplication,
};
