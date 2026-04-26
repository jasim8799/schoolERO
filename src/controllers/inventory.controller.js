const { HTTP_STATUS, USER_ROLES } = require('../config/constants.js');
const { logger }   = require('../utils/logger.js');
const { auditLog } = require('../utils/auditLog.js');
const Student   = require('../models/Student.js');
const User      = require('../models/User.js');
const Teacher   = require('../models/Teacher.js');
const Inventory = require('../models/Inventory.js');
const mongoose  = require('mongoose');

const exportInventoryController = async (req, res) => {
  try {
    const { role } = req.user;
    const schoolIdStr = (req.user.schoolId || req.schoolId || '').toString();

    if (![USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR].includes(role)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'Access denied. Principal or Operator only.'
      });
    }
    if (!schoolIdStr) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'School ID missing. Please log out and log in again.'
      });
    }

    let schoolObjId;
    try {
      schoolObjId = new mongoose.Types.ObjectId(schoolIdStr);
    } catch (e) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: `Invalid school ID: ${schoolIdStr}`
      });
    }

    // ── 1. Students ──────────────────────────────────────────────
    let students = [];
    try {
      students = await Student.find({ schoolId: schoolObjId })
        .populate('classId', 'name')
        .populate('sectionId', 'name')
        .populate({
          path: 'parentId',
          select: 'userId status',
          populate: { path: 'userId', select: 'name email mobile gender address' }
        })
        .populate('userId', 'mobile email')
        .lean();
      console.log('[INVENTORY] students:', students.length);
    } catch (e) {
      console.error('[INVENTORY] student error:', e.message);
    }

    // ── 2. Staff — use MongoDB aggregate to join Teacher + User ──
    // This bypasses ALL the schoolId/ObjectId matching issues
    let staff = [];
    try {
      // Get all Teacher docs for this school
      const teacherDocs = await Teacher.find({
        schoolId: schoolObjId
      }).lean();
      console.log('[INVENTORY] Teacher docs:', teacherDocs.length);

      if (teacherDocs.length > 0) {
        // Normalize userIds: ObjectId/string -> string -> ObjectId
        const userIdStrings = teacherDocs
          .map(t => t.userId?.toString())
          .filter(Boolean);

        const userIdObjs = userIdStrings.map(id =>
          new mongoose.Types.ObjectId(id)
        );

        console.log('[INVENTORY] Teacher userIds to fetch:', userIdObjs.length);

        // Fetch ALL those users in ONE query — no loop
        const teacherUsers = await User.find({
          _id: { $in: userIdObjs }
        })
        .select('-password -documents')
        .lean();

        console.log('[INVENTORY] Teacher users found:', teacherUsers.length);

        // Build userId → Teacher doc map
        const userIdToTeacher = {};
        teacherDocs.forEach(t => {
          if (t.userId) {
            userIdToTeacher[t.userId.toString()] = t;
          }
        });

        // Build staff array from matched users
        teacherUsers.forEach(u => {
          const t = userIdToTeacher[u._id.toString()];
          if (!t) return;
          staff.push({
            _id:        u._id.toString(),
            _teacherId: t._id.toString(),
            name:       u.name || '',
            email:      u.email || '',
            mobile:     u.mobile || '',
            whatsappNumber:  u.whatsappNumber || '',
            gender:          u.gender || '',
            dateOfBirth:     u.dateOfBirth || null,
            bloodGroup:      u.bloodGroup || '',
            address:         u.address || '',
            city:            u.city || '',
            state:           u.state || '',
            pincode:         u.pincode || '',
            employeeId:      u.employeeId || '',
            designation:     t.designation || u.designation || '',
            department:      u.department || '',
            qualification:   t.qualification || u.qualification || '',
            experienceYears: u.experienceYears || 0,
            monthlySalary:   u.monthlySalary || 0,
            subjects:        u.subjects || [],
            emergencyContactName:     u.emergencyContactName || '',
            emergencyContactRelation: u.emergencyContactRelation || '',
            emergencyContactPhone:    u.emergencyContactPhone || '',
            dateOfJoining: t.joiningDate || u.dateOfJoining || null,
            status:        t.status || 'active',
            role:          'TEACHER',
          });
        });

        console.log('[INVENTORY] teacher staff built:', staff.length);
      }

      // Also get OPERATOR and PRINCIPAL from User model directly
      const otherStaff = await User.find({
        schoolId: schoolObjId,
        role: { $in: ['OPERATOR', 'PRINCIPAL'] }
      })
      .select('-password -documents')
      .lean();

      console.log('[INVENTORY] operator/principal:', otherStaff.length);

      otherStaff.forEach(u => {
        staff.push({
          _id:        u._id.toString(),
          _teacherId: null,
          name:       u.name || '',
          email:      u.email || '',
          mobile:     u.mobile || '',
          whatsappNumber:  u.whatsappNumber || '',
          gender:          u.gender || '',
          dateOfBirth:     u.dateOfBirth || null,
          bloodGroup:      u.bloodGroup || '',
          address:         u.address || '',
          city:            u.city || '',
          state:           u.state || '',
          pincode:         u.pincode || '',
          employeeId:      u.employeeId || '',
          designation:     u.designation || '',
          department:      u.department || '',
          qualification:   u.qualification || '',
          experienceYears: u.experienceYears || 0,
          monthlySalary:   u.monthlySalary || 0,
          subjects:        u.subjects || [],
          emergencyContactName:     u.emergencyContactName || '',
          emergencyContactRelation: u.emergencyContactRelation || '',
          emergencyContactPhone:    u.emergencyContactPhone || '',
          dateOfJoining: u.dateOfJoining || null,
          status:        u.status || 'active',
          role:          u.role || '',
        });
      });

      console.log('[INVENTORY] FINAL staff:', staff.length);
    } catch (e) {
      console.error('[INVENTORY] staff error:', e.message);
      console.error('[INVENTORY] staff stack:', e.stack);
      staff = [];
    }

    // ── 3. Bills ─────────────────────────────────────────────────
    let billMap = {}, hostelFeeMap = {}, transportFeeMap = {};
    try {
      const Bill = mongoose.model('Bill');
      const bills = await Bill.find({ schoolId: schoolObjId })
        .select('studentId billType totalAmount paidAmount dueAmount')
        .lean();
      bills.forEach(b => {
        const sid = b.studentId?.toString();
        if (!sid) return;
        const total = b.totalAmount || 0;
        const paid  = b.paidAmount  || 0;
        const due   = b.dueAmount   || Math.max(0, total - paid);
        if (!billMap[sid]) billMap[sid] = { total: 0, paid: 0, due: 0 };
        billMap[sid].total += total;
        billMap[sid].paid  += paid;
        billMap[sid].due   += due;
        if (b.billType === 'HOSTEL') {
          if (!hostelFeeMap[sid]) hostelFeeMap[sid] = { paid: 0, pending: 0 };
          hostelFeeMap[sid].paid    += paid;
          hostelFeeMap[sid].pending += due;
        }
        if (b.billType === 'TRANSPORT') {
          if (!transportFeeMap[sid]) transportFeeMap[sid] = { paid: 0, pending: 0 };
          transportFeeMap[sid].paid    += paid;
          transportFeeMap[sid].pending += due;
        }
      });
      console.log('[INVENTORY] bills:', bills.length);
    } catch (e) {
      console.error('[INVENTORY] bill error:', e.message);
    }

    try {
      const TransportFee = mongoose.model('TransportFee');
      const fees = await TransportFee.find({ schoolId: schoolObjId })
        .select('studentId amount status').lean();
      fees.forEach(f => {
        const sid = f.studentId?.toString();
        if (!sid) return;
        if (!transportFeeMap[sid]) transportFeeMap[sid] = { paid: 0, pending: 0 };
        const amt = f.amount || 0;
        if (f.status === 'PAID') transportFeeMap[sid].paid += amt;
        else transportFeeMap[sid].pending += amt;
      });
    } catch (e) {
      console.log('[INVENTORY] TransportFee skip:', e.message);
    }

    // ── 4. Hostel ─────────────────────────────────────────────────
    let hostelMap = {};
    try {
      const StudentHostel = mongoose.model('StudentHostel');
      const assignments = await StudentHostel.find({
        schoolId: schoolObjId, status: 'ACTIVE'
      })
      .populate('hostelId', 'name wardenName')
      .populate('roomId', 'roomNumber floor')
      .lean();
      assignments.forEach(a => {
        const sid = a.studentId?.toString();
        if (sid) hostelMap[sid] = {
          hostelName: a.hostelId?.name || '',
          roomNumber: a.roomId?.roomNumber || '',
          floor:      a.roomId?.floor?.toString() || '',
        };
      });
      console.log('[INVENTORY] hostel:', assignments.length);
    } catch (e) {
      console.error('[INVENTORY] hostel error:', e.message);
    }

    // ── 5. Transport ──────────────────────────────────────────────
    let transportMap = {};
    try {
      const StudentTransport = mongoose.model('StudentTransport');
      const assignments = await StudentTransport.find({
        schoolId: schoolObjId, status: 'ACTIVE'
      })
      .populate('routeId', 'name startPoint endPoint')
      .populate('vehicleId', 'vehicleNumber driverName driverContact')
      .lean();
      assignments.forEach(a => {
        const sid = a.studentId?.toString();
        if (sid) transportMap[sid] = {
          routeName:     a.routeId?.name || '',
          startPoint:    a.routeId?.startPoint || '',
          endPoint:      a.routeId?.endPoint || '',
          vehicleNo:     a.vehicleId?.vehicleNumber || '',
          driverName:    a.vehicleId?.driverName || '',
          driverContact: a.vehicleId?.driverContact || '',
        };
      });
      console.log('[INVENTORY] transport:', assignments.length);
    } catch (e) {
      console.error('[INVENTORY] transport error:', e.message);
    }

    // ── 6. Staff attendance ───────────────────────────────────────
    let staffAttendanceMap = {};
    try {
      const StaffAttendance = mongoose.model('StaffAttendance');
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const records = await StaffAttendance.find({
        schoolId: schoolObjId, date: { $gte: since }
      }).select('staffId status').lean();
      records.forEach(r => {
        const uid = r.staffId?.toString();
        if (!uid) return;
        if (!staffAttendanceMap[uid])
          staffAttendanceMap[uid] = { present: 0, absent: 0, total: 0 };
        staffAttendanceMap[uid].total++;
        const s = (r.status || '').toUpperCase();
        if (s === 'PRESENT' || s === 'LATE' || s === 'HALF_DAY') {
          staffAttendanceMap[uid].present++;
        } else {
          staffAttendanceMap[uid].absent++;
        }
      });
      console.log('[INVENTORY] attendance:', records.length);
    } catch (e) {
      console.error('[INVENTORY] attendance error:', e.message);
    }

    // ── 7. Teacher class map ──────────────────────────────────────
    let teacherClassMap = {};
    try {
      const TeacherAssignment = mongoose.model('TeacherAssignment');
      const assignments = await TeacherAssignment.find({
        schoolId: schoolObjId
      })
      .populate('classId', 'name')
      .populate('sectionId', 'name')
      .lean();
      assignments.forEach(a => {
        const tid = a.teacherId?.toString();
        if (!tid) return;
        if (!teacherClassMap[tid]) teacherClassMap[tid] = new Set();
        const cls = a.classId?.name || '';
        const sec = a.sectionId?.name || '';
        const label = sec ? `${cls}-${sec}` : cls;
        if (label) teacherClassMap[tid].add(label);
      });
      Object.keys(teacherClassMap).forEach(k => {
        teacherClassMap[k] = [...teacherClassMap[k]];
      });
      console.log('[INVENTORY] classMap:', Object.keys(teacherClassMap).length);
    } catch (e) {
      console.error('[INVENTORY] classMap error:', e.message);
    }

    // ── 8. Physical inventory ─────────────────────────────────────
    let inventoryItems = [];
    try {
      inventoryItems = await Inventory.find({
        schoolId: schoolObjId
      }).lean();
      console.log('[INVENTORY] items:', inventoryItems.length);
    } catch (e) {
      console.error('[INVENTORY] items error:', e.message);
    }

    // ── Audit ─────────────────────────────────────────────────────
    try {
      await auditLog({
        action: 'INVENTORY_EXPORTED',
        entityType: 'INVENTORY',
        userId: req.user.userId || req.user._id,
        role, schoolId: schoolIdStr,
        details: { students: students.length, staff: staff.length },
        req,
      });
    } catch (e) {}

    // ── Class summary ─────────────────────────────────────────────
    const classMap = {};
    students.forEach(s => {
      const cls = s.classId?.name || 'Unknown';
      if (!classMap[cls]) classMap[cls] = { total:0, active:0, boys:0, girls:0 };
      classMap[cls].total++;
      if (s.status === 'ACTIVE') classMap[cls].active++;
      if (s.gender === 'Male')   classMap[cls].boys++;
      if (s.gender === 'Female') classMap[cls].girls++;
    });

    logger.success(
      `Export OK: ${students.length} students, ` +
      `${staff.length} staff, ${inventoryItems.length} items`
    );

    return res.status(HTTP_STATUS.OK).json({
      success: true,
      data: {
        students, staff, inventoryItems,
        billMap, hostelMap, hostelFeeMap,
        transportMap, transportFeeMap,
        teacherClassMap, staffAttendanceMap,
        classSummary: classMap,
        summary: {
          totalStudents:    students.length,
          activeStudents:   students.filter(s => s.status === 'ACTIVE').length,
          inactiveStudents: students.filter(s => s.status !== 'ACTIVE').length,
          totalStaff:       staff.length,
          teachers:  staff.filter(s => s.role === 'TEACHER').length,
          operators: staff.filter(s => s.role === 'OPERATOR').length,
          inventoryItems: inventoryItems.length,
        }
      },
      exportedAt: new Date().toISOString(),
    });

  } catch (error) {
    console.error('[INVENTORY EXPORT] Error:', error.message);
    console.error('[INVENTORY EXPORT] Stack:', error.stack);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error exporting school data',
      error: error.message,
    });
  }
};

module.exports = { exportInventoryController };
