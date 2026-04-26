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

    // Get schoolId as STRING — same way getAllUsers does it
    const schoolIdStr = (req.user.schoolId || req.schoolId || '').toString();

    console.log('[INVENTORY] role:', role);
    console.log('[INVENTORY] schoolIdStr:', schoolIdStr);

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

    // Use ObjectId only for models that need it
    let schoolObjId;
    try {
      schoolObjId = new mongoose.Types.ObjectId(schoolIdStr);
    } catch (e) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: `Invalid school ID: ${schoolIdStr}`
      });
    }

    // -- 1. Students ---------------------------------------------
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

    // -- 2. Staff - call same logic as getAllUsers exactly ----------
    let staff = [];
    try {
      // Mirror EXACTLY what getAllUsers does:
      // GET /api/users?schoolId=X&role=TEACHER
      // filterBySchool sets req.query.schoolId from req.user.schoolId
      // getAllUsers: User.find({ schoolId: req.query.schoolId, role: role })
      //
      // The key: filterBySchool uses req.user.schoolId which comes from
      // authenticate middleware: user.schoolId.toString()
      // This is already set in req.user.schoolId as a string
      //
      // Mongoose auto-casts string to ObjectId for ObjectId fields
      // So User.find({ schoolId: '67abc...' }) works fine

      const roles = ['TEACHER', 'OPERATOR', 'PRINCIPAL'];

      // Fetch each role separately - EXACT same as staff screen does
      // staff_management_screen: GET /api/users?schoolId=X&role=TEACHER
      //                           GET /api/users?schoolId=X&role=OPERATOR
      const allStaffArrays = await Promise.all(
        roles.map(r =>
          User.find({ schoolId: schoolIdStr, role: r })
            .select('-password -documents')
            .lean()
        )
      );

      const allStaff = allStaffArrays.flat();
      console.log('[INVENTORY] staff per role:',
        roles.map((r, i) => `${r}:${allStaffArrays[i].length}`).join(', '));
      console.log('[INVENTORY] total allStaff:', allStaff.length);

      // If string didn't work, try ObjectId
      if (allStaff.length === 0) {
        console.log('[INVENTORY] string query got 0 - trying ObjectId...');
        const allStaff2 = await User.find({
          schoolId: schoolObjId,
          role: { $in: roles }
        }).select('-password -documents').lean();
        console.log('[INVENTORY] ObjectId query result:', allStaff2.length);

        if (allStaff2.length === 0) {
          // Last resort: check if ANY user exists for this school
          const anyUser = await User.findOne({ schoolId: schoolObjId })
            .select('name role status schoolId').lean();
          console.log('[INVENTORY] any user for school:', JSON.stringify(anyUser));

          const anyTeacher = await User.findOne({ role: 'TEACHER' })
            .select('name schoolId').lean();
          console.log('[INVENTORY] any TEACHER in entire DB:',
            JSON.stringify(anyTeacher ? {
              name: anyTeacher.name,
              schoolId: anyTeacher.schoolId?.toString(),
              ourSchoolId: schoolIdStr,
              match: anyTeacher.schoolId?.toString() === schoolIdStr
            } : null));
        } else {
          allStaff.push(...allStaff2);
        }
      }

      // Get Teacher docs for class map (_teacherId lookup)
      if (allStaff.length > 0) {
        const teacherUserIds = allStaff
          .filter(u => u.role === 'TEACHER')
          .map(u => u._id);

        const teacherDocMap = {};
        if (teacherUserIds.length > 0) {
          const teacherDocs = await Teacher.find({
            userId: { $in: teacherUserIds }
          }).select('_id userId').lean();
          teacherDocs.forEach(t => {
            teacherDocMap[t.userId.toString()] = t._id.toString();
          });
          console.log('[INVENTORY] Teacher docs for class map:',
            teacherDocs.length);
        }

        staff = allStaff.map(u => ({
          _id:        u._id.toString(),
          _teacherId: teacherDocMap[u._id.toString()] || null,
          name:                     u.name,
          email:                    u.email,
          mobile:                   u.mobile,
          whatsappNumber:           u.whatsappNumber,
          gender:                   u.gender,
          dateOfBirth:              u.dateOfBirth,
          bloodGroup:               u.bloodGroup,
          address:                  u.address,
          city:                     u.city,
          state:                    u.state,
          pincode:                  u.pincode,
          employeeId:               u.employeeId,
          designation:              u.designation,
          department:               u.department,
          qualification:            u.qualification,
          experienceYears:          u.experienceYears,
          monthlySalary:            u.monthlySalary,
          subjects:                 u.subjects || [],
          emergencyContactName:     u.emergencyContactName,
          emergencyContactRelation: u.emergencyContactRelation,
          emergencyContactPhone:    u.emergencyContactPhone,
          dateOfJoining:            u.dateOfJoining,
          status:                   u.status,
          role:                     u.role,
        }));
      }

      console.log('[INVENTORY] FINAL staff:', staff.length);
    } catch (e) {
      console.error('[INVENTORY] staff error:', e.message);
      console.error('[INVENTORY] staff stack:', e.stack);
    }

    // -- 3. Bills ------------------------------------------------
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

    // TransportFee model supplement
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

    // -- 4. Hostel assignments -----------------------------------
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
          wardenName: a.hostelId?.wardenName || '',
          feeStatus:  a.feeStatus || '',
        };
      });
      console.log('[INVENTORY] hostel assignments:', assignments.length);
    } catch (e) {
      console.error('[INVENTORY] hostel error:', e.message);
    }

    // -- 5. Transport assignments --------------------------------
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

    // -- 6. Staff attendance -------------------------------------
    let staffAttendanceMap = {};
    try {
      const StaffAttendance = mongoose.model('StaffAttendance');
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const records = await StaffAttendance.find({
        schoolId: schoolObjId,
        date: { $gte: since }
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

    // -- 7. Teacher class map ------------------------------------
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
        const teacherDocId = a.teacherId?.toString();
        if (!teacherDocId) return;
        if (!teacherClassMap[teacherDocId]) teacherClassMap[teacherDocId] = new Set();
        const cls = a.classId?.name || '';
        const sec = a.sectionId?.name || '';
        const label = sec ? `${cls}-${sec}` : cls;
        if (label) teacherClassMap[teacherDocId].add(label);
      });
      Object.keys(teacherClassMap).forEach(k => {
        teacherClassMap[k] = [...teacherClassMap[k]];
      });
      console.log('[INVENTORY] teacherClassMap:', Object.keys(teacherClassMap).length);
    } catch (e) {
      console.error('[INVENTORY] teacher class map error:', e.message);
    }

    // -- 8. Physical inventory -----------------------------------
    let inventoryItems = [];
    try {
      inventoryItems = await Inventory.find({ schoolId: schoolObjId }).lean();
      console.log('[INVENTORY] physical items:', inventoryItems.length);
    } catch (e) {
      console.error('[INVENTORY] physical inventory error:', e.message);
    }

    // -- Audit ---------------------------------------------------
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

    // -- Class summary -------------------------------------------
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
          operators: staff.filter(s => s.role === USER_ROLES.OPERATOR).length,
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
