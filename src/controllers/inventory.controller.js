const { HTTP_STATUS, USER_ROLES } = require('../config/constants.js');
const { logger }   = require('../utils/logger.js');
const { auditLog } = require('../utils/auditLog.js');
const Student   = require('../models/Student.js');
const User      = require('../models/User.js');
const Teacher   = require('../models/Teacher.js');
const Inventory = require('../models/Inventory.js');
const mongoose  = require('mongoose');
const ExcelJS = require('exceljs');

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

    // ── 2. Staff ─────────────────────────────────────────────────
    let staff = [];
    try {
      const teacherDocs = await Teacher.find({
        schoolId: schoolObjId
      }).lean();
      console.log('[INVENTORY] Teacher docs:', teacherDocs.length);

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

      // Operators and Principals from User model
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
          whatsappNumber:  u.whatsappNumber  || '',
          gender:          u.gender          || '',
          dateOfBirth:     u.dateOfBirth     || null,
          bloodGroup:      u.bloodGroup      || '',
          address:         u.address         || '',
          city:            u.city            || '',
          state:           u.state           || '',
          pincode:         u.pincode         || '',
          employeeId:      u.employeeId      || '',
          designation:     u.designation     || '',
          department:      u.department      || '',
          qualification:   u.qualification   || '',
          experienceYears: u.experienceYears || 0,
          monthlySalary:   u.monthlySalary   || 0,
          subjects:        u.subjects        || [],
          emergencyContactName:     u.emergencyContactName     || '',
          emergencyContactRelation: u.emergencyContactRelation || '',
          emergencyContactPhone:    u.emergencyContactPhone    || '',
          dateOfJoining: u.dateOfJoining || null,
          status:        u.status || 'active',
          role:          u.role   || '',
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
