const { HTTP_STATUS, USER_ROLES } = require('../config/constants.js');
const { logger }   = require('../utils/logger.js');
const { auditLog } = require('../utils/auditLog.js');
const Student   = require('../models/Student.js');
const User      = require('../models/User.js');
const Teacher   = require('../models/Teacher.js');
const Inventory = require('../models/Inventory.js');
const mongoose  = require('mongoose');
const ExcelJS = require('exceljs');

// Other staff designations (must match StaffManagementScreen exactly)
const _otherStaffDesignations = [
  'Driver',
  'Cleaner',
  'Warden',
  'Peon',
  'Guard',
  'Cook',
  'Accountant',
  'Librarian',
  'Other',
];

const exportInventoryController = async (req, res) => {
  try {
    const { role, userId } = req.user;
    const schoolIdStr = (req.user.schoolId || req.schoolId || '').toString();

    // ===== DEBUG 1: Log JWT user info =====
    console.log('================================================');
    console.log('[DEBUG] INVENTORY EXPORT STARTED');
    console.log('[DEBUG] req.user.userId:', userId);
    console.log('[DEBUG] req.user.role:', role);
    console.log('[DEBUG] req.user.schoolId (from JWT):', schoolIdStr);
    console.log('[DEBUG] req.schoolId (fallback):', req.schoolId);
    console.log('================================================');

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

    // ===== DEBUG 2: Log converted schoolObjId =====
    console.log('[DEBUG] schoolObjId (converted):', schoolObjId.toString());
    console.log('[DEBUG] schoolObjId type:', typeof schoolObjId);
    console.log('[DEBUG] schoolObjId instanceof ObjectId:', schoolObjId instanceof mongoose.Types.ObjectId);
    console.log('================================================');

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
      console.log('[INVENTORY] Students:', students.length);
    } catch (e) {
      console.error('[INVENTORY] student error:', e.message);
    }

    // ── 1b. Parents ──────────────────────────────────────────────
    let parents = [];
    try {
      parents = students.filter(s => s.parentId).map(s => ({
        studentName: s.name || '',
        studentId: s._id?.toString() || '',
        parentName: s.parentId?.userId?.name || '',
        parentMobile: s.parentId?.userId?.mobile || '',
        parentEmail: s.parentId?.userId?.email || '',
        relation: s.parentId?.relation || 'Father'
      }));
      console.log('[INVENTORY] Parents:', parents.length);
    } catch (e) {
      console.error('[INVENTORY] parents error:', e.message);
    }

    // ── 1c. Classes ──────────────────────────────────────────────
    let classes = [];
    try {
      const Class = mongoose.model('Class');
      classes = await Class.find({ schoolId: schoolObjId }).lean();
      console.log('[INVENTORY] Classes:', classes.length);
    } catch (e) {
      console.error('[INVENTORY] classes error:', e.message);
    }

    // ── 1d. Sections ──────────────────────────────────────────────
    let sections = [];
    try {
      const Section = mongoose.model('Section');
      sections = await Section.find({ schoolId: schoolObjId }).lean();
      console.log('[INVENTORY] Sections:', sections.length);
    } catch (e) {
      console.error('[INVENTORY] sections error:', e.message);
    }

    // ── 1e. Subjects ──────────────────────────────────────────────
    let subjects = [];
    try {
      const Subject = mongoose.model('Subject');
      subjects = await Subject.find({ schoolId: schoolObjId }).lean();
      console.log('[INVENTORY] Subjects:', subjects.length);
    } catch (e) {
      console.error('[INVENTORY] subjects error:', e.message);
    }

    // ── 1f. Exams ─────────────────────────��────────────────────
    let exams = [];
    try {
      const Exam = mongoose.model('Exam');
      exams = await Exam.find({ schoolId: schoolObjId }).lean();
      console.log('[INVENTORY] Exams:', exams.length);
    } catch (e) {
      console.error('[INVENTORY] exams error:', e.message);
    }

    // ── 1g. Results ──────────────────────────────────────────────
    let results = [];
    try {
      const Result = mongoose.model('Result');
      results = await Result.find({ schoolId: schoolObjId }).lean();
      console.log('[INVENTORY] Results:', results.length);
    } catch (e) {
      console.error('[INVENTORY] results error:', e.message);
    }

    // ── 1h. Homework ──────────────────────────────────────────────
    let homework = [];
    try {
      const Homework = mongoose.model('Homework');
      homework = await Homework.find({ schoolId: schoolObjId }).lean();
      console.log('[INVENTORY] Homework:', homework.length);
    } catch (e) {
      console.error('[INVENTORY] homework error:', e.message);
    }

    // ── 1i. Notices ──────────────────────────────────────────────
    let notices = [];
    try {
      const Notice = mongoose.model('Notice');
      notices = await Notice.find({ schoolId: schoolObjId }).lean();
      console.log('[INVENTORY] Notices:', notices.length);
    } catch (e) {
      console.error('[INVENTORY] notices error:', e.message);
    }

    // ── 1j. PTM ──────────────────────────────────────────────
    let ptm = [];
    try {
      const PTM = mongoose.model('PTM');
      ptm = await PTM.find({ schoolId: schoolObjId }).lean();
      console.log('[INVENTORY] PTM:', ptm.length);
    } catch (e) {
      console.log('[INVENTORY] PTM skip:', e.message);
    }

// ── 1k. Users ──────────────────────────────────────────────
    let allUsers = [];
    try {
      // ===== STEP 2: DETAILED USER DEBUGGING =====
      console.log('================ USER DEBUG ================');
      
      console.log('TOKEN SCHOOL ID (String):', schoolIdStr);
      console.log('OBJECT SCHOOL ID (ObjectId):', schoolObjId.toString());
      
      // Total users in system
      const totalUsers = await User.countDocuments({});
      console.log('TOTAL USERS IN SYSTEM:', totalUsers);
      
      // Sample users without filter
      const sampleUsers = await User.find({})
      .select('name role schoolId status')
      .limit(20)
      .lean();
      
      console.log('SAMPLE USERS (first 20):', JSON.stringify(sampleUsers, null, 2));
      
      // Role distribution
      const roleStats = await User.aggregate([
      {
      $group: {
        _id: '$role',
        count: { $sum: 1 }
      }
      }
      ]);
      
      console.log('ROLE STATS (all roles in system):', JSON.stringify(roleStats, null, 2));
      
      // schoolId distribution
      const schoolStats = await User.aggregate([
      {
      $group: {
        _id: '$schoolId',
        count: { $sum: 1 }
      }
      }
      ]);
      
      console.log('SCHOOL STATS (by schoolId):', JSON.stringify(schoolStats, null, 2));
      
      // ===== TASK 2: QUERY AND LOG MATCHING USERS =====
      console.log('---------- QUERY: User.find({ schoolId: schoolObjId }) ----------');
      console.log('schoolId used in query:', schoolObjId.toString());
      console.log('schoolId type:', typeof schoolObjId);
      
      // Try querying with ObjectId
      const matchingUsers = await User.find({
        schoolId: schoolObjId
      })
      .select('name role schoolId status')
      .lean();

      console.log('MATCHING USERS (ObjectId query):', matchingUsers.length);
      if (matchingUsers.length > 0) {
        console.log('MATCHING USERS DATA:', JSON.stringify(matchingUsers, null, 2));
      }
      
      // Try querying with String (in case schoolId is stored as String)
      const matchingUsersStr = await User.find({
        schoolId: schoolIdStr
      })
      .select('name role schoolId status')
      .lean();

      console.log('MATCHING USERS (String query):', matchingUsersStr.length);
      
      // ===== TASK 4: LOG ROLE COUNTS =====
      const roleCounts = await User.aggregate([
        {
          $match: { schoolId: schoolObjId }
        },
        {
          $group: {
            _id: '$role',
            count: { $sum: 1 }
          }
        }
      ]);

      console.log('ROLE COUNTS (for this schoolId):', JSON.stringify(roleCounts, null, 2));
      
      console.log('============================================');
      
      allUsers = await User.find({ schoolId: schoolObjId })
        .select('-password -documents')
        .lean();
      console.log('[INVENTORY] Users:', allUsers.length);
    } catch (e) {
      console.error('[INVENTORY] users error:', e.message);
    }

    // ── 1l. Hostels ──────────────────────────────────────────────
    let hostels = [];
    try {
      const Hostel = mongoose.model('Hostel');
      hostels = await Hostel.find({ schoolId: schoolObjId }).lean();
      console.log('[INVENTORY] Hostels:', hostels.length);
    } catch (e) {
      console.error('[INVENTORY] hostels error:', e.message);
    }

    // ── 1m. Rooms ──────────────────────────────────────────────
    let rooms = [];
    try {
      const Room = mongoose.model('Room');
      rooms = await Room.find({ schoolId: schoolObjId }).lean();
      console.log('[INVENTORY] Rooms:', rooms.length);
    } catch (e) {
      console.error('[INVENTORY] rooms error:', e.message);
    }

    // ── 1n. Vehicles ──────────────────────────────────────────────
    let vehicles = [];
    try {
      const Vehicle = mongoose.model('Vehicle');
      vehicles = await Vehicle.find({ schoolId: schoolObjId }).lean();
      console.log('[INVENTORY] Vehicles:', vehicles.length);
    } catch (e) {
      console.error('[INVENTORY] vehicles error:', e.message);
    }

    // ── 1o. Routes ──────────────────────────────────────────────
    let routes = [];
    try {
      const Route = mongoose.model('Route');
      routes = await Route.find({ schoolId: schoolObjId }).lean();
      console.log('[INVENTORY] Routes:', routes.length);
    } catch (e) {
      console.error('[INVENTORY] routes error:', e.message);
    }

    // ── 1p. Expenses ──────────────────────────────────────────────
    let expenses = [];
    try {
      const Expense = mongoose.model('Expense');
      expenses = await Expense.find({ schoolId: schoolObjId }).lean();
      console.log('[INVENTORY] Expenses:', expenses.length);
    } catch (e) {
      console.error('[INVENTORY] expenses error:', e.message);
    }

    // ── 1q. Salary ──────────────────────────────────────────────
    let salary = [];
    try {
      const Salary = mongoose.model('Salary');
      salary = await Salary.find({ schoolId: schoolObjId }).lean();
      console.log('[INVENTORY] Salary:', salary.length);
    } catch (e) {
      console.log('[INVENTORY] Salary skip:', e.message);
    }

    // ── 1r. Automations ──────────────────────────────────────────────
    let automations = [];
    try {
      const AutomationRule = mongoose.model('AutomationRule');
      automations = await AutomationRule.find({ schoolId: schoolObjId }).lean();
      console.log('[INVENTORY] Automations:', automations.length);
    } catch (e) {
      console.error('[INVENTORY] automations error:', e.message);
    }

// ── 2. Staff ─────────────────────────────────────────────────
    let staff = [];
    try {
      // ===== TASK 3: QUERY AND LOG MATCHING TEACHERS =====
      console.log('================ TEACHER DEBUG ================');
      console.log('---------- Query: Teacher.find({ schoolId: schoolObjId }) ----------');
      console.log('schoolId used in query:', schoolObjId.toString());
      console.log('schoolId type:', typeof schoolObjId);
      
      // Try querying with ObjectId
      const teacherDocs = await Teacher.find({
        schoolId: schoolObjId
      }).lean();

      console.log('MATCHING TEACHERS (ObjectId query):', teacherDocs.length);
      
      // Try querying with String (in case schoolId is stored as String)
      const teacherDocsStr = await Teacher.find({
        schoolId: schoolIdStr
      }).lean();

      console.log('MATCHING TEACHERS (String query):', teacherDocsStr.length);
      
      console.log('Teacher docs found:', teacherDocs.length);

      if (teacherDocs.length > 0) {
        console.log('TEACHER SAMPLES:', JSON.stringify(teacherDocs.slice(0, 5), null, 2));
      }

      // ===== STEP 2: VERIFY TEACHER MAPPING =====
      console.log('================ TEACHER DEBUG ================');
      console.log('Teacher docs found:', teacherDocs.length);

      teacherDocs.slice(0, 5).forEach(t => {
        console.log({
          teacherId: t._id.toString(),
          userId: t.userId?.toString(),
          schoolId: t.schoolId?.toString()
        });
      });

      console.log('================================================');

      // Convert userIds to ObjectIds explicitly
      const userIdObjs = teacherDocs
        .map(t => {
          try {
            return t.userId
              ? new mongoose.Types.ObjectId(t.userId.toString())
              : null;
          } catch (e) { return null; }
        })
        .filter(Boolean);

      console.log('[INVENTORY] userIds to find:', userIdObjs.length);

      // Fetch matching User docs
      const teacherUsers = userIdObjs.length > 0
        ? await User.find({ _id: { $in: userIdObjs } })
            .select('-password -documents')
            .lean()
        : [];

      console.log('[INVENTORY] Teacher users found:', teacherUsers.length);

      // Build userId string → User doc map
      const userMap = {};
      teacherUsers.forEach(u => {
        userMap[u._id.toString()] = u;
      });

      // Build staff from Teacher docs — use User data if available,
      // fall back to Teacher data only if User not found
      teacherDocs.forEach(t => {
        const u = t.userId ? userMap[t.userId.toString()] : null;

        // Use User data if found, otherwise use placeholder
        staff.push({
          _id:        (u?._id || t.userId || t._id).toString(),
          _teacherId: t._id.toString(),
          name:       u?.name       || `Teacher (${t._id.toString().slice(-4)})`,
          email:      u?.email      || '',
          mobile:     u?.mobile     || '',
          whatsappNumber:  u?.whatsappNumber  || '',
          gender:          u?.gender          || '',
          dateOfBirth:     u?.dateOfBirth     || null,
          bloodGroup:      u?.bloodGroup      || '',
          address:         u?.address         || '',
          city:            u?.city            || '',
          state:           u?.state           || '',
          pincode:         u?.pincode         || '',
          employeeId:      u?.employeeId      || '',
          designation:     t.designation  || u?.designation  || '',
          department:      u?.department      || '',
          qualification:   t.qualification || u?.qualification || '',
          experienceYears: u?.experienceYears || 0,
          monthlySalary:   u?.monthlySalary   || 0,
          subjects:        u?.subjects        || [],
          emergencyContactName:     u?.emergencyContactName     || '',
          emergencyContactRelation: u?.emergencyContactRelation || '',
          emergencyContactPhone:    u?.emergencyContactPhone    || '',
          dateOfJoining: t.joiningDate || u?.dateOfJoining || null,
          status:        t.status || 'active',
          role:          'TEACHER',
        });
      });

console.log('[INVENTORY] teacher staff built:', staff.length);

// ===== TASK 2: FIXED STAFF QUERY =====
// Fix: Use EXACTLY the same logic as StaffManagementScreen
// 1. Fetch OPERATOR role users (not role filter like before!)
// 2. Split by designation field to get operators vs other staff

// First try with ObjectId, then fallback to String (support both formats)
let operatorUsers = await User.find({
  schoolId: schoolObjId,
  role: 'OPERATOR',
  isDeleted: { $ne: true }
})
.select('-password -documents')
.lean();

// If no results with ObjectId, try with string schoolId
if (operatorUsers.length === 0) {
  operatorUsers = await User.find({
    schoolId: schoolIdStr,
    role: 'OPERATOR',
    isDeleted: { $ne: true }
  })
  .select('-password -documents')
  .lean();
}

console.log('[INVENTORY] [STAFF QUERY] role: OPERATOR');
console.log('[INVENTORY] operatorUsers count:', operatorUsers.length);

// Split operators by designation (exactly like StaffManagementScreen)
const operators = [];
const otherStaff = [];

operatorUsers.forEach(u => {
  const designation = (u.designation || '').toString().trim();
  if (_otherStaffDesignations.includes(designation)) {
    otherStaff.push({
      ...u,
      role: 'OPERATOR',
      category: 'OTHER_STAFF'
    });
  } else {
    operators.push({
      ...u,
      role: 'OPERATOR',
      category: 'OPERATOR'
    });
  }
});

console.log('[INVENTORY] operators (non-designation roles):', operators.length);
console.log('[INVENTORY] otherStaff (designation roles):', otherStaff.length);

// ===== REQUIREMENT 5 & 9: ADD DEBUG LOGS =====
console.log('EXPORT SCHOOL ID:', schoolIdStr);
console.log('OPERATORS COUNT:', operators.length);
console.log('TEACHERS COUNT:', staff.filter(s => s.role === 'TEACHER').length);
console.log('OTHER STAFF COUNT:', otherStaff.length);
console.log('SAMPLE OPERATOR:', operators[0] ? JSON.stringify(operators[0]) : 'none');
console.log('SAMPLE TEACHER:', staff.filter(s => s.role === 'TEACHER')[0] ? JSON.stringify(staff.filter(s => s.role === 'TEACHER')[0]) : 'none');
console.log('SAMPLE OTHER STAFF:', otherStaff[0] ? JSON.stringify(otherStaff[0]) : 'none');

// ===== REQUIREMENT 9: Role distribution =====
const roleDistribution = await User.aggregate([
  {
    $match: { schoolId: schoolObjId }
  },
  {
    $group: {
      _id: "$role",
      count: { $sum: 1 }
    }
  }
]);
console.log('ROLE DISTRIBUTION:', JSON.stringify(roleDistribution));

// Add to staff array - operators first
operators.forEach(u => {
  staff.push({
    _id: u._id.toString(),
    _teacherId: null,
    name: u.name || '',
    email: u.email || '',
    mobile: u.mobile || '',
    whatsappNumber: u.whatsappNumber || '',
    gender: u.gender || '',
    dateOfBirth: u.dateOfBirth || null,
    bloodGroup: u.bloodGroup || '',
    address: u.address || '',
    city: u.city || '',
    state: u.state || '',
    pincode: u.pincode || '',
    employeeId: u.employeeId || '',
    designation: u.designation || '',
    department: u.department || '',
    qualification: u.qualification || '',
    experienceYears: u.experienceYears || 0,
    monthlySalary: u.monthlySalary || 0,
    subjects: u.subjects || [],
    emergencyContactName: u.emergencyContactName || '',
    emergencyContactRelation: u.emergencyContactRelation || '',
    emergencyContactPhone: u.emergencyContactPhone || '',
    dateOfJoining: u.dateOfJoining || null,
    status: u.status || 'active',
    role: 'OPERATOR',
  });
});

// Add otherStaff (support staff with designations)
otherStaff.forEach(u => {
  staff.push({
    _id: u._id.toString(),
    _teacherId: null,
    name: u.name || '',
    email: u.email || '',
    mobile: u.mobile || '',
    whatsappNumber: u.whatsappNumber || '',
    gender: u.gender || '',
    dateOfBirth: u.dateOfBirth || null,
    bloodGroup: u.bloodGroup || '',
    address: u.address || '',
    city: u.city || '',
    state: u.state || '',
    pincode: u.pincode || '',
    employeeId: u.employeeId || '',
    designation: u.designation || '',
    department: u.department || '',
    qualification: u.qualification || '',
    experienceYears: u.experienceYears || 0,
    monthlySalary: u.monthlySalary || 0,
    subjects: u.subjects || [],
    emergencyContactName: u.emergencyContactName || '',
    emergencyContactRelation: u.emergencyContactRelation || '',
    emergencyContactPhone: u.emergencyContactPhone || '',
    dateOfJoining: u.dateOfJoining || null,
    status: u.status || 'active',
    role: 'OPERATOR',
  });
});

console.log('[INVENTORY] FINAL staff:', staff.length);

      // ===== TASK 1: VERIFY API RESPONSE =====
      console.log('========== INVENTORY EXPORT ==========');
      console.log('students:', students.length);
      console.log('staff:', staff.length);
      if (staff.length > 0) {
        console.log('staff roles:', [...new Set(staff.map(s => s.role))]);
      }
      console.log('======================================');

      // ===== TASK 3: EXPORT STAFF SEPARATELY =====
      const teachers = staff.filter(x => x.role === 'TEACHER');
      const operators = staff.filter(x => x.role === 'OPERATOR');
      const principals = staff.filter(x => x.role === 'PRINCIPAL');
      const wardens = staff.filter(x => x.role === 'WARDEN');
      const drivers = staff.filter(x => x.role === 'DRIVER');
      const accountants = staff.filter(x => x.role === 'ACCOUNTANT');
      const librarians = staff.filter(x => x.role === 'LIBRARIAN');
      const receptionists = staff.filter(x => x.role === 'RECEPTIONIST');

console.log('[INVENTORY] Role counts:', {
        teachers: teachers.length,
        operators: operators.length,
        principals: principals.length,
        wardens: wardens.length,
        drivers: drivers.length,
        accountants: accountants.length,
        librarians: librarians.length,
        receptionists: receptionists.length,
      });

      // ===== STEP 5: VERIFY RESPONSE DATA =====
      console.log('================ EXPORT RESPONSE ================');
      console.log('students:', students.length);
      console.log('staff:', staff.length);
      console.log('teachers:', teachers.length);
      console.log('operators:', operators.length);
      console.log('principals:', principals.length);
      console.log('wardens:', wardens.length);
      console.log('drivers:', drivers.length);
      console.log('accountants:', accountants.length);
      console.log('librarians:', librarians.length);
      console.log('receptionists:', receptionists.length);
      console.log('=================================================');

      // Store separate arrays - will be added to response
      var staffByRole = {
        teachers: teachers,
        operators: operators,
        principals: principals,
        wardens: wardens,
        drivers: drivers,
        accountants: accountants,
        librarians: librarians,
        receptionists: receptionists,
      };

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
        // Core datasets
        students, staff, inventoryItems,
        
        // Extended datasets - ALL modules
        parents, classes, sections, subjects,
        exams, results, homework, notices, ptm,
        allUsers, hostels, rooms, vehicles, routes,
        expenses, salary, automations,
        
        // Maps and summaries
        billMap, hostelMap, hostelFeeMap,
        transportMap, transportFeeMap,
        teacherClassMap, staffAttendanceMap,
        classSummary: classMap,
        
        // ===== TASK 3: EXPORT STAFF SEPARATELY =====
        // Staff by role
        teachers: staffByRole ? staffByRole.teachers : [],
        operators: staffByRole ? staffByRole.operators : [],
        principals: staffByRole ? staffByRole.principals : [],
        wardens: staffByRole ? staffByRole.wardens : [],
        drivers: staffByRole ? staffByRole.drivers : [],
        accountants: staffByRole ? staffByRole.accountants : [],
        librarians: staffByRole ? staffByRole.librarians : [],
        receptionists: staffByRole ? staffByRole.receptionists : [],
        
        // Summary
        summary: {
          totalStudents:    students.length,
          parents: parents.length,
          activeStudents:   students.filter(s => s.status === 'ACTIVE').length,
          inactiveStudents: students.filter(s => s.status !== 'ACTIVE').length,
          totalStaff:       staff.length,
          teachers:  staff.filter(s => s.role === 'TEACHER').length,
          operators: staff.filter(s => s.role === 'OPERATOR').length,
          principals: staff.filter(s => s.role === 'PRINCIPAL').length,
          wardens: staff.filter(s => s.role === 'WARDEN').length,
          drivers: staff.filter(s => s.role === 'DRIVER').length,
          accountants: staff.filter(s => s.role === 'ACCOUNTANT').length,
          librarians: staff.filter(s => s.role === 'LIBRARIAN').length,
          receptionists: staff.filter(s => s.role === 'RECEPTIONIST').length,
          classes: classes.length,
          sections: sections.length,
          subjects: subjects.length,
          exams: exams.length,
          results: results.length,
          homework: homework.length,
          notices: notices.length,
          ptm: ptm.length,
          users: allUsers.length,
          hostels: hostels.length,
          rooms: rooms.length,
          vehicles: vehicles.length,
          routes: routes.length,
          expenses: expenses.length,
          salary: salary.length,
          automations: automations.length,
          inventoryItems: inventoryItems.length,
        }
      },
// ===== TASK 6 & 7: RETURN DEBUG INFORMATION IN RESPONSE =====
      // Staff arrays separately
      operators: operators,
      teachers: staff.filter(s => s.role === 'TEACHER'),
      otherStaff: otherStaff,

      // Summary counts
      operatorsCount: operators.length,
      teachersCount: staff.filter(s => s.role === 'TEACHER').length,
      otherStaffCount: otherStaff.length,

      // ===== REQUIREMENT 10: FINAL DEBUG BLOCK =====
      debug: {
        userId: userId,
        role: role,
        schoolIdFromJWT: schoolIdStr,
        schoolObjIdUsed: schoolObjId ? schoolObjId.toString() : null,
        studentsCount: students.length,
        usersCount: allUsers.length,
        teachersCount: staff.filter(s => s.role === 'TEACHER').length,
        staffCount: staff.length,
        operatorsCount: operators.length,
        otherStaffCount: otherStaff.length,
        totalUsersMatched: allUsers.length,
        roleDistribution: roleDistribution,
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

// Full School Inventory Export Controller - Excel with all modules
const exportFullInventoryController = async (req, res) => {
  try {
    const { role } = req.user;
    const schoolIdStr = (req.user.schoolId || req.schoolId || '').toString();

    // Security check - Principal or Operator only
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

    console.log('[BACKUP] Export started');

    // Load all data modules in parallel using Promise.all for performance
    const [
      studentsData,
      staffData,
      usersData,
      classesData,
      sectionsData,
      subjectsData,
      billsData,
      expensesData,
      noticesData,
      hostelsData,
      roomsData,
      vehiclesData,
      routesData,
      examsData,
      resultsData,
      homeworkData,
      automationsData
    ] = await Promise.all([
      // 1. Students
      Student.find({ schoolId: schoolObjId })
        .populate('classId', 'name')
        .populate('sectionId', 'name')
        .populate({ path: 'parentId', populate: { path: 'userId', select: 'name mobile email' } })
        .populate('userId', 'mobile email')
        .lean()
        .then(d => { console.log('[BACKUP] Students loaded:', d.length); return d; })
        .catch(() => []),

      // 2. Staff (Teachers + Operators + Principals)
      Teacher.find({ schoolId: schoolObjId }).lean()
        .then(async (teacherDocs) => {
          const userIds = teacherDocs.map(t => t.userId).filter(Boolean);
          const users = userIds.length > 0 ? await User.find({ _id: { $in: userIds } }).select('-password').lean() : [];
          const userMap = {};
          users.forEach(u => { userMap[u._id.toString()] = u; });
          return teacherDocs.map(t => ({
            _id: t._id.toString(),
            name: userMap[t.userId?.toString()]?.name || '',
            email: userMap[t.userId?.toString()]?.email || '',
            mobile: userMap[t.userId?.toString()]?.mobile || '',
            role: 'TEACHER',
            designation: t.designation || '',
            status: t.status || 'active'
          }));
        })
        .catch(() => []),

      // 3. All Users
      User.find({ schoolId: schoolObjId }).select('-password -documents').lean()
        .then(d => { console.log('[BACKUP] Users loaded:', d.length); return d; })
        .catch(() => []),

      // 4. Classes
      mongoose.model('Class').find({ schoolId: schoolObjId }).lean()
        .then(d => { console.log('[BACKUP] Classes loaded:', d.length); return d; })
        .catch(() => []),

      // 5. Sections
      mongoose.model('Section').find({ schoolId: schoolObjId }).lean()
        .then(d => { console.log('[BACKUP] Sections loaded:', d.length); return d; })
        .catch(() => []),

      // 6. Subjects
      mongoose.model('Subject').find({ schoolId: schoolObjId }).lean()
        .then(d => { console.log('[BACKUP] Subjects loaded:', d.length); return d; })
        .catch(() => []),

      // 7. Bills
      mongoose.model('Bill').find({ schoolId: schoolObjId }).lean()
        .then(d => { console.log('[BACKUP] Bills loaded:', d.length); return d; })
        .catch(() => []),

      // 8. Expenses
      mongoose.model('Expense').find({ schoolId: schoolObjId }).lean()
        .then(d => { console.log('[BACKUP] Expenses loaded:', d.length); return d; })
        .catch(() => []),

      // 9. Notices
      mongoose.model('Notice').find({ schoolId: schoolObjId }).lean()
        .then(d => { console.log('[BACKUP] Notices loaded:', d.length); return d; })
        .catch(() => []),

      // 10. Hostels
      mongoose.model('Hostel').find({ schoolId: schoolObjId }).lean()
        .then(d => { console.log('[BACKUP] Hostels loaded:', d.length); return d; })
        .catch(() => []),

      // 11. Rooms
      mongoose.model('Room').find({ schoolId: schoolObjId }).lean()
        .then(d => { console.log('[BACKUP] Rooms loaded:', d.length); return d; })
        .catch(() => []),

      // 12. Vehicles
      mongoose.model('Vehicle').find({ schoolId: schoolObjId }).lean()
        .then(d => { console.log('[BACKUP] Vehicles loaded:', d.length); return d; })
        .catch(() => []),

      // 13. Routes
      mongoose.model('Route').find({ schoolId: schoolObjId }).lean()
        .then(d => { console.log('[BACKUP] Routes loaded:', d.length); return d; })
        .catch(() => []),

      // 14. Exams
      mongoose.model('Exam').find({ schoolId: schoolObjId }).lean()
        .then(d => { console.log('[BACKUP] Exams loaded:', d.length); return d; })
        .catch(() => []),

      // 15. Results
      mongoose.model('Result').find({ schoolId: schoolObjId }).lean()
        .then(d => { console.log('[BACKUP] Results loaded:', d.length); return d; })
        .catch(() => []),

      // 16. Homework
      mongoose.model('Homework').find({ schoolId: schoolObjId }).lean()
        .then(d => { console.log('[BACKUP] Homework loaded:', d.length); return d; })
        .catch(() => []),

      // 17. Automations
      mongoose.model('AutomationRule').find({ schoolId: schoolObjId }).lean()
        .then(d => { console.log('[BACKUP] Automations loaded:', d.length); return d; })
        .catch(() => [])
    ]);

    console.log('[BACKUP] All data loaded, generating workbook...');

    // Create Excel workbook with multiple sheets
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'School ERP';
    workbook.created = new Date();

    // Helper function to add sheet data
    const addSheet = (name, headers, rows) => {
      const sheet = workbook.addWorksheet(name);
      sheet.columns = headers.map((h, i) => ({ header: h, key: `col${i}`, width: 15 }));
      rows.forEach(row => {
        const rowData = {};
        headers.forEach((h, i) => { rowData[`col${i}`] = row[i] || ''; });
        sheet.addRow(rowData);
      });
      sheet.getRow(1).font = { bold: true };
    };

    // Sheet 1: School Info
    addSheet('School_Info', ['Field', 'Value'], [
      ['School ID', schoolIdStr],
      ['Export Date', new Date().toISOString()],
      ['Total Students', studentsData.length],
      ['Total Staff', staffData.length],
      ['Total Users', usersData.length]
    ]);

    // Sheet 2: Students
    addSheet('Students', ['Name', 'Roll No', 'Class', 'Section', 'Gender', 'Mobile', 'Status', 'Admission Date'], 
      studentsData.map(s => [
        s.name || s.userId?.name || '',
        s.rollNumber || '',
        s.classId?.name || '',
        s.sectionId?.name || '',
        s.gender || '',
        s.mobile || s.userId?.mobile || '',
        s.status || 'active',
        s.registrationDate ? new Date(s.registrationDate).toLocaleDateString() : ''
      ])
    );

    // Sheet 3: Parents
    const parentsData = studentsData.filter(s => s.parentId).map(s => ({
      studentName: s.name || '',
      parentName: s.parentId?.userId?.name || '',
      parentMobile: s.parentId?.userId?.mobile || '',
      parentEmail: s.parentId?.userId?.email || ''
    }));
    addSheet('Parents', ['Student Name', 'Parent Name', 'Mobile', 'Email'], parentsData);

    // Sheet 4: Staff
    addSheet('Staff', ['Name', 'Role', 'Designation', 'Mobile', 'Email', 'Status'],
      staffData.map(s => [s.name, s.role, s.designation, s.mobile, s.email, s.status])
    );

    // Sheet 5: Users
    addSheet('Users', ['Name', 'Role', 'Mobile', 'Email', 'Status'],
      usersData.map(u => [u.name, u.role, u.mobile, u.email, u.status])
    );

    // Sheet 6: Classes
    addSheet('Classes', ['Name', 'Numeric', 'Status'],
      classesData.map(c => [c.name, c.numeric, c.status])
    );

    // Sheet 7: Sections
    addSheet('Sections', ['Name', 'Class', 'Status'],
      sectionsData.map(s => [s.name, s.classId?.name || '', s.status])
    );

    // Sheet 8: Subjects
    addSheet('Subjects', ['Name', 'Code', 'Class', 'Status'],
      subjectsData.map(s => [s.name, s.code, s.classId?.name || '', s.status])
    );

    // Sheet 9: Fees (Bills)
    addSheet('Fees', ['Student', 'Type', 'Total', 'Paid', 'Due', 'Status'],
      billsData.map(b => [
        b.studentId?.toString() || '',
        b.billType || 'TUTION',
        b.totalAmount || 0,
        b.paidAmount || 0,
        b.dueAmount || 0,
        b.status || ''
      ])
    );

    // Sheet 10: Expenses
    addSheet('Expenses', ['Title', 'Amount', 'Category', 'Date', 'Status'],
      expensesData.map(e => [e.title, e.amount, e.category, e.date ? new Date(e.date).toLocaleDateString() : '', e.status])
    );

    // Sheet 11: Notices
    addSheet('Notices', ['Title', 'Content', 'Posted For', 'Date'],
      noticesData.map(n => [n.title, n.content?.substring(0, 100), n.postFor, n.createdAt ? new Date(n.createdAt).toLocaleDateString() : ''])
    );

    // Sheet 12: Hostels
    addSheet('Hostels', ['Name', 'Type', 'Warden', 'Total Rooms', 'Status'],
      hostelsData.map(h => [h.name, h.type, h.wardenName, h.totalRooms, h.status])
    );

    // Sheet 13: Rooms
    addSheet('Rooms', ['Room Number', 'Hostel', 'Floor', 'Capacity', 'Occupied', 'Status'],
      roomsData.map(r => [r.roomNumber, r.hostelId?.name || '', r.floor, r.capacity, r.occupied, r.status])
    );

    // Sheet 14: Vehicles
    addSheet('Vehicles', ['Vehicle No', 'Driver Name', 'Driver Contact', 'Capacity', 'Status'],
      vehiclesData.map(v => [v.vehicleNumber, v.driverName, v.driverContact, v.capacity, v.status])
    );

    // Sheet 15: Routes
    addSheet('Routes', ['Name', 'Start Point', 'End Point', 'Fare', 'Status'],
      routesData.map(r => [r.name, r.startPoint, r.endPoint, r.fare, r.status])
    );

    // Sheet 16: Exams
    addSheet('Exams', ['Name', 'Class', 'Start Date', 'End Date', 'Status'],
      examsData.map(e => [e.name, e.classId?.name || '', e.startDate ? new Date(e.startDate).toLocaleDateString() : '', e.endDate ? new Date(e.endDate).toLocaleDateString() : '', e.status])
    );

    // Sheet 17: Results
    addSheet('Results', ['Student', 'Exam', 'Subject', 'Marks', 'Grade'],
      resultsData.map(r => [r.studentId?.toString(), r.examId?.name || '', r.subjectId?.name || '', r.marks, r.grade])
    );

    // Sheet 18: Homework
    addSheet('Homework', ['Class', 'Subject', 'Title', 'Description', 'Due Date'],
      homeworkData.map(h => [h.classId?.name || '', h.subjectId?.name || '', h.title, h.description?.substring(0, 50), h.dueDate ? new Date(h.dueDate).toLocaleDateString() : ''])
    );

    // Sheet 19: Automations
    addSheet('Automations', ['Name', 'Trigger', 'Action', 'Status'],
      automationsData.map(a => [a.name, a.trigger, a.action, a.status])
    );

    console.log('[BACKUP] Workbook generated');

    // Generate Excel file
    const buffer = await workbook.xlsx.writeBuffer();
    
    console.log('[BACKUP] Export complete');

    // Audit log
    try {
      await auditLog({
        action: 'FULL_INVENTORY_EXPORTED',
        entityType: 'INVENTORY',
        userId: req.user.userId || req.user._id,
        role, schoolId: schoolIdStr,
        details: { 
          students: studentsData.length, 
          staff: staffData.length,
          users: usersData.length 
        },
        req,
      });
    } catch (e) {}

    // Return Excel file
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=School_Backup_${new Date().toISOString().split('T')[0]}.xlsx`);
    return res.send(buffer);

  } catch (error) {
    console.error('[BACKUP EXPORT] Error:', error.message);
    console.error('[BACKUP EXPORT] Stack:', error.stack);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error exporting full school inventory',
      error: error.message,
    });
  }
};

module.exports = { exportInventoryController, exportFullInventoryController };
