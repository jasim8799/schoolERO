const { HTTP_STATUS, USER_ROLES } = require('../config/constants.js');
const { logger } = require('../utils/logger.js');
const { auditLog } = require('../utils/auditLog.js');
const Student = require('../models/Student.js');
const User = require('../models/User.js');
const Teacher = require('../models/Teacher.js');
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

    // 1. Students
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
      console.log('[INVENTORY] students:', students.length);
    } catch (e) {
      console.error('[INVENTORY] student error:', e.message);
    }

    // 2. BUG FIX: Fetch Teachers from Teacher model
    let staff = [];
    try {
      const teachers = await Teacher.find({
        schoolId: schoolObjId,
        status: 'active'
      })
        .populate({
          path: 'userId',
          select: '-password -documents'
        })
        .lean();

      console.log('[INVENTORY] teachers from Teacher model:', teachers.length);

      staff = teachers
        .filter((t) => t.userId)
        .map((t) => ({
          _teacherId: t._id.toString(),
          _id: t.userId._id.toString(),
          name: t.userId.name,
          email: t.userId.email,
          mobile: t.userId.mobile,
          whatsappNumber: t.userId.whatsappNumber,
          gender: t.userId.gender,
          dateOfBirth: t.userId.dateOfBirth,
          bloodGroup: t.userId.bloodGroup,
          address: t.userId.address,
          city: t.userId.city,
          state: t.userId.state,
          pincode: t.userId.pincode,
          occupation: t.userId.occupation,
          employeeId: t.userId.employeeId,
          designation: t.designation || t.userId.designation,
          department: t.userId.department,
          qualification: t.qualification || t.userId.qualification,
          experienceYears: t.userId.experienceYears,
          monthlySalary: t.userId.monthlySalary,
          subjects: t.userId.subjects || [],
          emergencyContactName: t.userId.emergencyContactName,
          emergencyContactRelation: t.userId.emergencyContactRelation,
          emergencyContactPhone: t.userId.emergencyContactPhone,
          status: t.status,
          role: 'TEACHER',
          dateOfJoining: t.joiningDate || t.userId.dateOfJoining,
        }));

      const otherStaff = await User.find({
        schoolId: schoolObjId,
        role: { $in: [USER_ROLES.OPERATOR, USER_ROLES.PRINCIPAL] },
        status: 'active',
      })
        .select('-password -documents')
        .lean();

      console.log('[INVENTORY] operators/principals:', otherStaff.length);

      otherStaff.forEach((u) => {
        staff.push({
          _teacherId: null,
          _id: u._id.toString(),
          name: u.name,
          email: u.email,
          mobile: u.mobile,
          whatsappNumber: u.whatsappNumber,
          gender: u.gender,
          dateOfBirth: u.dateOfBirth,
          bloodGroup: u.bloodGroup,
          address: u.address,
          city: u.city,
          state: u.state,
          pincode: u.pincode,
          employeeId: u.employeeId,
          designation: u.designation,
          department: u.department,
          qualification: u.qualification,
          experienceYears: u.experienceYears,
          monthlySalary: u.monthlySalary,
          subjects: u.subjects || [],
          emergencyContactName: u.emergencyContactName,
          emergencyContactRelation: u.emergencyContactRelation,
          emergencyContactPhone: u.emergencyContactPhone,
          status: u.status,
          role: u.role,
          dateOfJoining: u.dateOfJoining,
        });
      });

      console.log('[INVENTORY] total staff:', staff.length);
    } catch (e) {
      console.error('[INVENTORY] staff error:', e.message);
    }

    // 3. Fee bills
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
    }

    // 4. Hostel assignments
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
        if (sid) {
          hostelMap[sid] = {
            hostelName: a.hostelId?.name || '',
            roomNumber: a.roomId?.roomNumber || '',
            floor: a.roomId?.floor || '',
          };
        }
      });
    } catch (e) {
      console.error('[INVENTORY] hostel error:', e.message);
    }

    // 5. Hostel fees
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
      console.error('[INVENTORY] hostel fee error:', e.message);
    }

    // 6. Transport assignments
    let transportMap = {};
    try {
      const StudentTransport = mongoose.model('StudentTransport');
      const assignments = await StudentTransport.find({
        schoolId: schoolObjId
      })
        .populate('routeId', 'name startPoint endPoint')
        .populate('vehicleId', 'vehicleNumber driverName driverMobile')
        .lean();
      assignments.forEach((a) => {
        const sid = a.studentId?.toString();
        if (sid) {
          transportMap[sid] = {
            routeName: a.routeId?.name || '',
            startPoint: a.routeId?.startPoint || '',
            endPoint: a.routeId?.endPoint || '',
            vehicleNo: a.vehicleId?.vehicleNumber || '',
            driverName: a.vehicleId?.driverName || '',
            driverMobile: a.vehicleId?.driverMobile || '',
          };
        }
      });
    } catch (e) {
      console.error('[INVENTORY] transport error:', e.message);
    }

    // 7. Transport fees
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
        if (typeof f.totalAmount === 'number') {
          transportFeeMap[sid].paid += f.paidAmount || 0;
          transportFeeMap[sid].pending += Math.max(0, (f.totalAmount || 0) - (f.paidAmount || 0));
        } else {
          const amt = f.amount || 0;
          if (f.status === 'PAID') transportFeeMap[sid].paid += amt;
          else transportFeeMap[sid].pending += amt;
        }
      });
    } catch (e) {
      console.error('[INVENTORY] transport fee error:', e.message);
    }

    // 8. BUG FIX: Teacher class map
    let teacherClassMap = {};
    try {
      const TeacherAssignment = mongoose.model('TeacherAssignment');
      const assignments = await TeacherAssignment.find({
        schoolId: schoolObjId
      })
        .populate('classId', 'name')
        .populate('sectionId', 'name')
        .lean();

      assignments.forEach((a) => {
        const teacherDocId = a.teacherId?.toString();
        if (!teacherDocId) return;
        if (!teacherClassMap[teacherDocId]) teacherClassMap[teacherDocId] = [];
        const cls = a.classId?.name || '';
        const sec = a.sectionId?.name || '';
        const label = sec ? `${cls}-${sec}` : cls;
        if (label && !teacherClassMap[teacherDocId].includes(label)) {
          teacherClassMap[teacherDocId].push(label);
        }
      });
      console.log('[INVENTORY] teacherClassMap keys:', Object.keys(teacherClassMap).length);
    } catch (e) {
      console.error('[INVENTORY] teacher class map error:', e.message);
    }

    // 9. Staff attendance
    let staffAttendanceMap = {};
    try {
      const StaffAttendance = mongoose.model('StaffAttendance');
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const records = await StaffAttendance.find({
        schoolId: schoolObjId,
        date: { $gte: since }
      }).select('staffId userId status').lean();

      records.forEach((r) => {
        const uid = (r.staffId || r.userId)?.toString();
        if (!uid) return;
        if (!staffAttendanceMap[uid]) {
          staffAttendanceMap[uid] = { present: 0, absent: 0, total: 0 };
        }
        staffAttendanceMap[uid].total++;
        const s = (r.status || '').toUpperCase();
        if (s === 'PRESENT') staffAttendanceMap[uid].present++;
        else staffAttendanceMap[uid].absent++;
      });
    } catch (e) {
      console.error('[INVENTORY] staff attendance error:', e.message);
    }

    // 10. Physical inventory
    let inventoryItems = [];
    try {
      inventoryItems = await Inventory.find({
        schoolId: schoolObjId
      }).lean();
    } catch (e) {
      console.error('[INVENTORY] physical inventory error:', e.message);
    }

    // Audit
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
      classMap[cls].total++;
      if (s.status === 'ACTIVE') classMap[cls].active++;
      if (s.gender === 'Male') classMap[cls].boys++;
      if (s.gender === 'Female') classMap[cls].girls++;
    });

    logger.success(
      `Export OK: ${students.length} students, ${staff.length} staff, ` +
      `${inventoryItems.length} items`
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
          teachers: staff.filter((s) => s.role === 'TEACHER').length,
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
