const { HTTP_STATUS, USER_ROLES } = require('../config/constants.js');
const { logger } = require('../utils/logger.js');
const { auditLog } = require('../utils/auditLog.js');
const Student = require('../models/Student.js');
const User = require('../models/User.js');
const Inventory = require('../models/Inventory.js');
const mongoose = require('mongoose');

const exportInventoryController = async (req, res) => {
  try {
    const { role } = req.user;
    const rawSchoolId = req.user.schoolId || req.schoolId;

    if (![USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR].includes(role)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'Access denied. Principal or Operator only.'
      });
    }

    if (!rawSchoolId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'School ID missing. Please log out and log in again.'
      });
    }

    let schoolObjId;
    try {
      schoolObjId = new mongoose.Types.ObjectId(rawSchoolId.toString());
    } catch (e) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: `Invalid school ID: ${rawSchoolId}`
      });
    }

    // 1. Students with class/section/parent
    let students = [];
    try {
      students = await Student.find({ schoolId: schoolObjId })
        .populate('classId', 'name')
        .populate('sectionId', 'name')
        .populate({
          path: 'parentId',
          select: 'userId status',
          populate: {
            path: 'userId',
            select: 'name email mobile gender address'
          }
        })
        .populate('userId', 'mobile email')
        .lean();
    } catch (e) {
      console.error('[INVENTORY] student error:', e.message);
    }

    // 2. Staff
    let staff = [];
    try {
      staff = await User.find({
        schoolId: schoolObjId,
        role: { $in: [USER_ROLES.TEACHER, USER_ROLES.OPERATOR, USER_ROLES.PRINCIPAL] },
        status: 'active',
      }).select('-password -documents').lean();
    } catch (e) {
      console.error('[INVENTORY] staff error:', e.message);
    }

    // 3. Fee bills per student
    let billMap = {};
    try {
      const Bill = mongoose.model('Bill');
      const bills = await Bill.find({ schoolId: schoolObjId })
        .select('studentId totalAmount paidAmount status')
        .lean();
      bills.forEach((b) => {
        const sid = b.studentId?.toString();
        if (!sid) return;
        if (!billMap[sid]) billMap[sid] = { total: 0, paid: 0, due: 0 };
        billMap[sid].total += b.totalAmount || 0;
        billMap[sid].paid += b.paidAmount || 0;
        billMap[sid].due += Math.max(0, (b.totalAmount || 0) - (b.paidAmount || 0));
      });
    } catch (e) {
      console.error('[INVENTORY] bill error:', e.message);
      billMap = {};
    }

    // 4. Student hostel assignments
    let hostelMap = {};
    try {
      const StudentHostel = mongoose.model('StudentHostel');
      const assignments = await StudentHostel.find({
        schoolId: schoolObjId,
        status: 'ACTIVE'
      })
        .populate('hostelId', 'name')
        .populate('roomId', 'roomNumber floor')
        .lean();
      assignments.forEach((a) => {
        const sid = a.studentId?.toString();
        if (!sid) return;
        hostelMap[sid] = {
          hostelName: a.hostelId?.name || '',
          roomNumber: a.roomId?.roomNumber || '',
          floor: a.roomId?.floor || '',
        };
      });
    } catch (e) {
      console.error('[INVENTORY] hostel assignment error:', e.message);
    }

    // 5. Hostel fees per student (fallback to Bill(HOSTEL) if HostelFee model unavailable)
    let hostelFeeMap = {};
    try {
      const HostelFee = mongoose.model('HostelFee');
      const fees = await HostelFee.find({ schoolId: schoolObjId })
        .select('studentId totalAmount paidAmount')
        .lean();
      fees.forEach((f) => {
        const sid = f.studentId?.toString();
        if (!sid) return;
        if (!hostelFeeMap[sid]) hostelFeeMap[sid] = { paid: 0, pending: 0 };
        hostelFeeMap[sid].paid += f.paidAmount || 0;
        hostelFeeMap[sid].pending += Math.max(0, (f.totalAmount || 0) - (f.paidAmount || 0));
      });
    } catch (e) {
      try {
        const Bill = mongoose.model('Bill');
        const bills = await Bill.find({ schoolId: schoolObjId, billType: 'HOSTEL' })
          .select('studentId totalAmount paidAmount')
          .lean();
        bills.forEach((b) => {
          const sid = b.studentId?.toString();
          if (!sid) return;
          if (!hostelFeeMap[sid]) hostelFeeMap[sid] = { paid: 0, pending: 0 };
          hostelFeeMap[sid].paid += b.paidAmount || 0;
          hostelFeeMap[sid].pending += Math.max(0, (b.totalAmount || 0) - (b.paidAmount || 0));
        });
      } catch (fallbackError) {
        console.error('[INVENTORY] hostel fee error:', fallbackError.message);
      }
    }

    // 6. Student transport assignments
    let transportMap = {};
    try {
      const StudentTransport = mongoose.model('StudentTransport');
      const assignments = await StudentTransport.find({ schoolId: schoolObjId, status: 'ACTIVE' })
        .populate('routeId', 'name startPoint endPoint')
        .populate('vehicleId', 'vehicleNumber driverName driverMobile')
        .lean();
      assignments.forEach((a) => {
        const sid = a.studentId?.toString();
        if (!sid) return;
        transportMap[sid] = {
          routeName: a.routeId?.name || '',
          startPoint: a.routeId?.startPoint || '',
          endPoint: a.routeId?.endPoint || '',
          vehicleNo: a.vehicleId?.vehicleNumber || '',
          driverName: a.vehicleId?.driverName || '',
          driverMobile: a.vehicleId?.driverMobile || '',
        };
      });
    } catch (e) {
      console.error('[INVENTORY] transport error:', e.message);
    }

    // 7. Transport fees per student
    let transportFeeMap = {};
    try {
      const TransportFee = mongoose.model('TransportFee');
      const fees = await TransportFee.find({ schoolId: schoolObjId })
        .select('studentId totalAmount paidAmount amount status')
        .lean();
      fees.forEach((f) => {
        const sid = f.studentId?.toString();
        if (!sid) return;
        if (!transportFeeMap[sid]) transportFeeMap[sid] = { paid: 0, pending: 0 };

        if (typeof f.totalAmount === 'number' || typeof f.paidAmount === 'number') {
          const total = f.totalAmount || 0;
          const paid = f.paidAmount || 0;
          transportFeeMap[sid].paid += paid;
          transportFeeMap[sid].pending += Math.max(0, total - paid);
          return;
        }

        // Fallback for current model shape: amount + status
        const amount = f.amount || 0;
        if (f.status === 'PAID') {
          transportFeeMap[sid].paid += amount;
        } else {
          transportFeeMap[sid].pending += amount;
        }
      });
    } catch (e) {
      console.error('[INVENTORY] transport fee error:', e.message);
    }

    // 8. Teacher to class assignments
    let teacherClassMap = {};
    try {
      const TeacherAssignment = mongoose.model('TeacherAssignment');
      const assignments = await TeacherAssignment.find({ schoolId: schoolObjId })
        .populate('classId', 'name')
        .populate('sectionId', 'name')
        .populate('teacherId', 'userId')
        .lean();

      assignments.forEach((a) => {
        const teacherUserId = a.teacherId?.userId?.toString();
        if (!teacherUserId) return;
        if (!teacherClassMap[teacherUserId]) teacherClassMap[teacherUserId] = [];
        const cls = a.classId?.name || '';
        const sec = a.sectionId?.name || '';
        const label = sec ? `${cls}-${sec}` : cls;
        if (label && !teacherClassMap[teacherUserId].includes(label)) {
          teacherClassMap[teacherUserId].push(label);
        }
      });
    } catch (e) {
      console.error('[INVENTORY] teacher assignments error:', e.message);
    }

    // 9. Staff attendance summary
    let staffAttendanceMap = {};
    try {
      const StaffAttendance = mongoose.model('StaffAttendance');
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const records = await StaffAttendance.find({
        schoolId: schoolObjId,
        date: { $gte: since }
      }).select('staffId status').lean();

      records.forEach((r) => {
        const uid = r.staffId?.toString();
        if (!uid) return;
        if (!staffAttendanceMap[uid]) {
          staffAttendanceMap[uid] = { present: 0, absent: 0, total: 0 };
        }
        staffAttendanceMap[uid].total += 1;
        if (r.status === 'PRESENT' || r.status === 'present') {
          staffAttendanceMap[uid].present += 1;
        } else {
          staffAttendanceMap[uid].absent += 1;
        }
      });
    } catch (e) {
      console.error('[INVENTORY] staff attendance error:', e.message);
    }

    // 10. Physical inventory
    let inventoryItems = [];
    try {
      inventoryItems = await Inventory.find({ schoolId: schoolObjId }).lean();
    } catch (e) {
      console.error('[INVENTORY] physical inventory error:', e.message);
    }

    // Audit log
    try {
      await auditLog({
        action: 'INVENTORY_EXPORTED',
        entityType: 'INVENTORY',
        userId: req.user.userId || req.user._id,
        role,
        schoolId: rawSchoolId,
        details: { students: students.length, staff: staff.length },
        req,
      });
    } catch (e) {}

    // Class-wise summary
    const classMap = {};
    students.forEach((s) => {
      const cls = s.classId?.name || 'Unknown';
      if (!classMap[cls]) classMap[cls] = { total: 0, active: 0, boys: 0, girls: 0 };
      classMap[cls].total += 1;
      if (s.status === 'ACTIVE') classMap[cls].active += 1;
      if (s.gender === 'Male') classMap[cls].boys += 1;
      if (s.gender === 'Female') classMap[cls].girls += 1;
    });

    logger.success(
      `School export OK: ${students.length} students, ` +
      `${staff.length} staff, ${inventoryItems.length} items`
    );

    return res.status(HTTP_STATUS.OK).json({
      success: true,
      data: {
        students,
        staff,
        inventoryItems,
        billMap,
        hostelMap,
        hostelFeeMap,
        transportMap,
        transportFeeMap,
        teacherClassMap,
        staffAttendanceMap,
        classSummary: classMap,
        summary: {
          totalStudents: students.length,
          activeStudents: students.filter((s) => s.status === 'ACTIVE').length,
          inactiveStudents: students.filter((s) => s.status !== 'ACTIVE').length,
          totalStaff: staff.length,
          teachers: staff.filter((s) => s.role === USER_ROLES.TEACHER).length,
          operators: staff.filter((s) => s.role === USER_ROLES.OPERATOR).length,
          inventoryItems: inventoryItems.length,
        }
      },
      exportedAt: new Date().toISOString(),
    });

  } catch (error) {
    console.error('[INVENTORY EXPORT] Error:', error);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error exporting school data',
      error: error.message,
    });
  }
};

module.exports = { exportInventoryController };