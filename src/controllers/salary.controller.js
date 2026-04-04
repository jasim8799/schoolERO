const SalaryProfile = require('../models/SalaryProfile');
const SalaryCalculation = require('../models/SalaryCalculation');
const SalaryPayment = require('../models/SalaryPayment');
const LedgerEntry = require('../models/LedgerEntry');
const User = require('../models/User');
const TeacherAttendance = require('../models/TeacherAttendance');
const StaffAdvance = require('../models/StaffAdvance');
const PDFDocument = require('pdfkit');
const { USER_ROLES, USER_STATUS } = require('../config/constants');
const { auditLog } = require('../utils/auditLog');

// Setup salary profile
const setupSalaryProfile = async (req, res) => {
  try {
    const { userId, baseSalary, allowances, deductions } = req.body;
    const { schoolId } = req.user;

    // Validate required fields
    if (!userId || baseSalary === undefined) {
      return res.status(400).json({ message: 'userId and baseSalary are required' });
    }

    // Validate baseSalary
    if (baseSalary < 0) {
      return res.status(400).json({ message: 'Base salary cannot be negative' });
    }

    // Check if user exists and is a staff member
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if user belongs to the same school
    if (user.schoolId.toString() !== schoolId.toString()) {
      return res.status(403).json({ message: 'User does not belong to this school' });
    }

    // Check if user is a staff member (not student or parent)
    const staffRoles = [USER_ROLES.TEACHER, USER_ROLES.OPERATOR, USER_ROLES.PRINCIPAL, 'PEON'];
    if (!staffRoles.includes(user.role)) {
      return res.status(400).json({ message: 'Salary profile can only be created for staff members' });
    }

    // Check if salary profile already exists
    const existingProfile = await SalaryProfile.findOne({ userId, schoolId });
    if (existingProfile) {
      return res.status(409).json({ message: 'Salary profile already exists for this staff member' });
    }

    // Create salary profile
    const salaryProfile = await SalaryProfile.create({
      userId,
      baseSalary: parseFloat(baseSalary),
      allowances: allowances || [],
      deductions: deductions || [],
      schoolId
    });

    // Populate user details
    await salaryProfile.populate('userId', 'name email mobile role');

    res.status(201).json({
      message: 'Salary profile created successfully',
      salaryProfile
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Salary profile already exists for this staff member' });
    }
    res.status(500).json({ message: err.message });
  }
};

// Get salary profile by staff ID
const getSalaryProfile = async (req, res) => {
  try {
    const { id: userId } = req.params;
    const { schoolId, _id: currentUserId, role } = req.user;

    // Check access permissions
    const adminRoles = [USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR];
    if (!adminRoles.includes(role) && currentUserId.toString() !== userId) {
      return res.status(403).json({ message: 'Access denied. You can only view your own salary profile' });
    }

    // Find salary profile
    const salaryProfile = await SalaryProfile.findOne({ userId, schoolId })
      .populate('userId', 'name email mobile role');

    if (!salaryProfile) {
      return res.status(404).json({ message: 'Salary profile not found' });
    }

    res.json({
      salaryProfile
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── Shared helper: calculate and persist salary for one staff member ──────────
const _calcForStaff = async ({ staffId, month, schoolId }) => {
  const [year, monthNum] = month.split('-');
  const workingDays = new Date(year, monthNum, 0).getDate();

  const startDate = new Date(`${month}-01`);
  const endDate   = new Date(startDate);
  endDate.setMonth(endDate.getMonth() + 1);

  const attendanceDays = await TeacherAttendance.countDocuments({
    teacherId: staffId, schoolId,
    date: { $gte: startDate, $lt: endDate },
    status: 'PRESENT',
  });

  const salaryProfile = await SalaryProfile.findOne({ userId: staffId, schoolId });
  if (!salaryProfile) return null; // no profile — skip

  const perDay          = salaryProfile.baseSalary / workingDays;
  const earned          = perDay * attendanceDays;
  const allowancesTotal = salaryProfile.allowances.reduce((s, a) => s + a.amount, 0);
  const grossSalary     = earned + allowancesTotal;
  const deductionsTotal = salaryProfile.deductions.reduce((s, d) => s + d.amount, 0);
  const netPayable      = Math.max(0, grossSalary - deductionsTotal);

  const salaryCalculation = await SalaryCalculation.create({
    staffId, month, schoolId,
    baseSalary: salaryProfile.baseSalary,
    attendanceDays,
    workingDays,
    leaveDays: 0,
    grossSalary,
    deductions: deductionsTotal,
    netPayable,
  });

  return salaryCalculation;
};

// Calculate salary — single staff (staffId provided) or bulk (staffId omitted)
const calculateSalary = async (req, res) => {
  try {
    const { staffId, month } = req.body;
    const { schoolId } = req.user;

    if (!month) {
      return res.status(400).json({ message: 'month is required (format: YYYY-MM)' });
    }

    const monthRegex = /^\d{4}-\d{2}$/;
    if (!monthRegex.test(month)) {
      return res.status(400).json({ message: 'Invalid month format. Use YYYY-MM' });
    }

    // ── SINGLE mode ──────────────────────────────────────────────────────────
    if (staffId) {
      const staff = await User.findById(staffId);
      if (!staff) return res.status(404).json({ message: 'Staff not found' });

      if (staff.schoolId.toString() !== schoolId.toString()) {
        return res.status(403).json({ message: 'Staff does not belong to this school' });
      }

      const staffRoles = [USER_ROLES.TEACHER, USER_ROLES.OPERATOR, USER_ROLES.PRINCIPAL, 'PEON'];
      if (!staffRoles.includes(staff.role)) {
        return res.status(400).json({ message: 'User is not a staff member' });
      }

      const existing = await SalaryCalculation.findOne({ staffId, month, schoolId });
      if (existing) {
        return res.status(409).json({ message: 'Salary calculation already exists for this staff and month' });
      }

      const salaryCalculation = await _calcForStaff({ staffId, month, schoolId });
      if (!salaryCalculation) {
        return res.status(404).json({ message: 'Salary profile not found for this staff member' });
      }

      await salaryCalculation.populate('staffId', 'name email mobile role');

      await auditLog({
        action: 'SALARY_CALCULATION',
        userId: req.user._id, role: req.user.role,
        entityType: 'SalaryCalculation', entityId: salaryCalculation._id,
        description: `Salary calculated for ${staff.name} for month ${month}`,
        schoolId: req.user.schoolId, sessionId: req.user.sessionId, req,
      });

      return res.status(201).json({ message: 'Salary calculated successfully', salaryCalculation });
    }

    // ── BULK mode ────────────────────────────────────────────────────────────
    const staffRoles = [USER_ROLES.TEACHER, USER_ROLES.OPERATOR, USER_ROLES.PRINCIPAL, 'PEON'];
    const staffList  = await User.find({
      schoolId,
      role:   { $in: staffRoles },
      status: USER_STATUS.ACTIVE,
    }).select('_id name');

    let created = 0;
    let skipped = 0;
    const errors = [];

    for (const member of staffList) {
      try {
        const existing = await SalaryCalculation.findOne({ staffId: member._id, month, schoolId });
        if (existing) { skipped++; continue; }

        const calc = await _calcForStaff({ staffId: member._id, month, schoolId });
        if (!calc) { skipped++; continue; } // no salary profile
        created++;
      } catch (e) {
        errors.push({ staff: member.name, error: e.message });
      }
    }

    await auditLog({
      action: 'SALARY_BULK_CALCULATION',
      userId: req.user._id, role: req.user.role,
      entityType: 'SalaryCalculation', entityId: null,
      description: `Bulk salary calculated for month ${month}: ${created} created, ${skipped} skipped`,
      schoolId: req.user.schoolId, sessionId: req.user.sessionId, req,
    });

    return res.status(201).json({
      message: `Salary generated for all staff`,
      month,
      total:   staffList.length,
      created,
      skipped,
      ...(errors.length ? { errors } : {}),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get monthly salary calculations
const getMonthlySalaries = async (req, res) => {
  try {
    const { month } = req.query;
    const { schoolId } = req.user;

    // Validate month parameter
    if (!month) {
      return res.status(400).json({ message: 'Month parameter is required (format: YYYY-MM)' });
    }

    // Validate month format
    const monthRegex = /^\d{4}-\d{2}$/;
    if (!monthRegex.test(month)) {
      return res.status(400).json({ message: 'Invalid month format. Use YYYY-MM' });
    }

    // Get salary calculations for the month
    const salaryCalculations = await SalaryCalculation.find({ schoolId, month })
      .populate('staffId', 'name email mobile role')
      .sort({ createdAt: -1 });

    res.json({
      month,
      salaryCalculations
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Pay salary
const paySalary = async (req, res) => {
  try {
    const { salaryCalculationId, paymentMode } = req.body;
    const { _id: paidBy, schoolId } = req.user;

    // Validate required fields
    if (!salaryCalculationId || !paymentMode) {
      return res.status(400).json({ message: 'salaryCalculationId and paymentMode are required' });
    }

    // Normalize and validate paymentMode
    const normalizedMode = (paymentMode || '').toLowerCase();
    if (!['cash', 'bank'].includes(normalizedMode)) {
      return res.status(400).json({ message: 'Invalid paymentMode. Must be cash or bank' });
    }

    // Find salary calculation
    const salaryCalculation = await SalaryCalculation.findById(salaryCalculationId)
      .populate('staffId', 'name email mobile role');

    if (!salaryCalculation) {
      return res.status(404).json({ message: 'Salary calculation not found' });
    }

    // Check if belongs to same school
    if (salaryCalculation.schoolId.toString() !== schoolId.toString()) {
      return res.status(403).json({ message: 'Salary calculation does not belong to this school' });
    }

    // Check if already paid
    if (salaryCalculation.status === 'Paid') {
      return res.status(409).json({ message: 'Salary has already been paid' });
    }

    // Check if payment already exists
    const existingPayment = await SalaryPayment.findOne({ salaryCalculationId });
    if (existingPayment) {
      return res.status(409).json({ message: 'Payment already exists for this salary calculation' });
    }

    // Create salary payment
    const salaryPayment = await SalaryPayment.create({
      salaryCalculationId,
      staffId: salaryCalculation.staffId._id,
      month: salaryCalculation.month,
      amountPaid: salaryCalculation.netPayable,
      paymentMode: normalizedMode,
      paidBy,
      schoolId
    });

    // Update salary calculation status to Paid
    salaryCalculation.status = 'Paid';
    await salaryCalculation.save();

    // Ledger dual-write — never fail the salary payment
    try {
      const AcademicSession = require('../models/AcademicSession');
      const activeSession = await AcademicSession.findOne({
        schoolId, isActive: true
      });
      await LedgerEntry.create({
        schoolId,
        sessionId: activeSession?._id,
        entryType: 'CREDIT',
        category: 'SALARY_PAYMENT',
        amount: salaryCalculation.netPayable,
        description: `Salary paid — ${salaryCalculation.staffId.name} — ${salaryCalculation.month}`,
        referenceId: salaryPayment._id,
        sourceModel: 'SalaryPayment',
        performedBy: paidBy,
        entryDate: new Date()
      });
    } catch (ledgerErr) {
      console.error('[LedgerEntry] salary dual-write failed:', ledgerErr.message);
    }

    // Populate payment details
    await salaryPayment.populate('paidBy', 'name');

    // Audit log
    await auditLog({
      action: 'SALARY_PAYMENT',
      userId: req.user._id,
      role: req.user.role,
      entityType: 'SalaryPayment',
      entityId: salaryPayment._id,
      description: `Salary paid to ${salaryCalculation.staffId.name} for month ${salaryCalculation.month}`,
      schoolId: req.user.schoolId,
      sessionId: req.user.sessionId,
      req
    });

    res.status(201).json({
      message: 'Salary paid successfully',
      salaryPayment,
      salaryCalculation
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Salary has already been paid' });
    }
    res.status(500).json({ message: err.message });
  }
};

// Get salary slip for authenticated user
const getSalarySlip = async (req, res) => {
  try {
    const { month } = req.params;
    const { _id: userId, schoolId, role } = req.user;

    // Validate month format
    const monthRegex = /^\d{4}-\d{2}$/;
    if (!monthRegex.test(month)) {
      return res.status(400).json({ message: 'Invalid month format. Use YYYY-MM' });
    }

    // Find salary calculation for the user and month
    const salaryCalculation = await SalaryCalculation.findOne({
      staffId: userId,
      month,
      schoolId
    }).populate('staffId', 'name email mobile role');

    if (!salaryCalculation) {
      return res.status(404).json({ message: 'Salary slip not found for this month' });
    }

    // Find payment if exists
    const salaryPayment = await SalaryPayment.findOne({
      salaryCalculationId: salaryCalculation._id
    }).populate('paidBy', 'name');

    // Get salary profile for allowances/deductions details
    const salaryProfile = await SalaryProfile.findOne({
      userId: userId,
      schoolId
    });

    const slip = {
      month,
      staff: {
        id: salaryCalculation.staffId._id,
        name: salaryCalculation.staffId.name,
        email: salaryCalculation.staffId.email,
        mobile: salaryCalculation.staffId.mobile,
        role: salaryCalculation.staffId.role
      },
      salaryDetails: {
        baseSalary: salaryCalculation.baseSalary,
        workingDays: salaryCalculation.workingDays,
        attendanceDays: salaryCalculation.attendanceDays,
        leaveDays: salaryCalculation.leaveDays,
        allowances: salaryProfile ? salaryProfile.allowances : [],
        deductions: salaryProfile ? salaryProfile.deductions : [],
        grossSalary: salaryCalculation.grossSalary,
        totalDeductions: salaryCalculation.deductions,
        netPayable: salaryCalculation.netPayable
      },
      payment: salaryPayment ? {
        amountPaid: salaryPayment.amountPaid,
        paymentMode: salaryPayment.paymentMode,
        paymentDate: salaryPayment.paymentDate,
        paidBy: salaryPayment.paidBy.name
      } : null,
      status: salaryCalculation.status
    };

    res.json({
      slip
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getSalarySlipPdf = async (req, res) => {
  try {
    const { month } = req.params;
    const { _id: userId, schoolId } = req.user;

    // Validate month format
    const monthRegex = /^\d{4}-\d{2}$/;
    if (!monthRegex.test(month)) {
      return res.status(400).json({ message: 'Invalid month format. Use YYYY-MM' });
    }

    const salaryCalculation = await SalaryCalculation.findOne({
      staffId: userId,
      month,
      schoolId
    }).populate('staffId', 'name email mobile role');

    if (!salaryCalculation) {
      return res.status(404).json({ message: 'Salary slip not found' });
    }

    const salaryProfile = await SalaryProfile.findOne({
      userId: userId,
      schoolId
    });

    const salaryPayment = await SalaryPayment.findOne({
      salaryCalculationId: salaryCalculation._id
    }).populate('paidBy', 'name');

    // Format month display (e.g., "2024-01" -> "January 2024")
    const [year, monthNum] = month.split('-');
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                       'July', 'August', 'September', 'October', 'November', 'December'];
    const formattedMonth = `${monthNames[parseInt(monthNum) - 1]} ${year}`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=salary-slip-${salaryCalculation.staffId.name.replace(/\s+/g, '-')}-${month}.pdf`
    );

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text('School ERP', { align: 'center' });
    doc.moveDown();
    doc.fontSize(16).font('Helvetica').text(`Salary Slip - ${formattedMonth}`, { align: 'center' });
    doc.moveDown(2);

    // Employee Details
    doc.fontSize(14).font('Helvetica-Bold').text('Employee Details:', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(12).font('Helvetica');
    doc.text(`Name: ${salaryCalculation.staffId.name}`);
    doc.text(`Role: ${salaryCalculation.staffId.role}`);
    doc.text(`Email: ${salaryCalculation.staffId.email || 'N/A'}`);
    doc.text(`Mobile: ${salaryCalculation.staffId.mobile || 'N/A'}`);
    doc.moveDown(1);

    // Salary Details
    doc.fontSize(14).font('Helvetica-Bold').text('Salary Details:', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(12).font('Helvetica');
    doc.text(`Base Salary: ₹${salaryCalculation.baseSalary.toLocaleString()}`);
    doc.text(`Working Days: ${salaryCalculation.workingDays}`);
    doc.text(`Attendance Days: ${salaryCalculation.attendanceDays}`);
    doc.text(`Leave Days: ${salaryCalculation.leaveDays}`);
    doc.moveDown(0.5);

    // Allowances
    if (salaryProfile?.allowances?.length > 0) {
      doc.font('Helvetica-Bold').text('Allowances:');
      doc.font('Helvetica');
      salaryProfile.allowances.forEach(allowance => {
        doc.text(`${allowance.name}: ₹${allowance.amount.toLocaleString()}`);
      });
      doc.moveDown(0.5);
    }

    // Deductions
    if (salaryProfile?.deductions?.length > 0) {
      doc.font('Helvetica-Bold').text('Deductions:');
      doc.font('Helvetica');
      salaryProfile.deductions.forEach(deduction => {
        doc.text(`${deduction.name}: ₹${deduction.amount.toLocaleString()}`);
      });
      doc.moveDown(0.5);
    }

    // Net Payable
    doc.font('Helvetica-Bold').text(`Net Payable: ₹${salaryCalculation.netPayable.toLocaleString()}`);
    doc.moveDown(1);

    // Payment Information
    doc.fontSize(14).font('Helvetica-Bold').text('Payment Information:', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(12).font('Helvetica');
    doc.text(`Status: ${salaryCalculation.status}`);

    if (salaryPayment) {
      doc.text(`Payment Mode: ${salaryPayment.paymentMode}`);
      doc.text(`Payment Date: ${new Date(salaryPayment.paymentDate).toLocaleDateString()}`);
      doc.text(`Paid By: ${salaryPayment.paidBy.name}`);
    }

    // Footer
    doc.moveDown(3);
    doc.fontSize(10).text(`Generated on ${new Date().toDateString()}`, { align: 'center' });
    doc.text('School ERP System - Confidential Document', { align: 'center' });

    doc.end();
  } catch (err) {
    console.error('PDF generation error:', err);
    res.status(500).json({ message: 'Error generating PDF', error: err.message });
  }
};

// Get all staff members (all roles except STUDENT, PARENT, SUPER_ADMIN)
const getAllStaffList = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const staffRoles = [USER_ROLES.TEACHER, USER_ROLES.OPERATOR, USER_ROLES.PRINCIPAL, 'PEON'];
    const users = await User.find({ schoolId, role: { $in: staffRoles }, status: USER_STATUS.ACTIVE })
      .select('name email mobile role')
      .sort({ role: 1, name: 1 });
    res.json({ data: users });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get salary slip for any staff - admin only
const getStaffSlipAdmin = async (req, res) => {
  try {
    const { staffId, month } = req.params;
    const { schoolId } = req.user;

    const monthRegex = /^\d{4}-\d{2}$/;
    if (!monthRegex.test(month)) {
      return res.status(400).json({ message: 'Invalid month format. Use YYYY-MM' });
    }

    const salaryCalculation = await SalaryCalculation.findOne({ staffId, month, schoolId })
      .populate('staffId', 'name email mobile role');
    if (!salaryCalculation) {
      return res.status(404).json({ message: 'Salary slip not found for this staff and month' });
    }

    const salaryPayment = await SalaryPayment.findOne({ salaryCalculationId: salaryCalculation._id })
      .populate('paidBy', 'name');

    const salaryProfile = await SalaryProfile.findOne({ userId: staffId, schoolId });

    const slip = {
      month,
      staff: {
        id: salaryCalculation.staffId._id,
        name: salaryCalculation.staffId.name,
        email: salaryCalculation.staffId.email,
        mobile: salaryCalculation.staffId.mobile,
        role: salaryCalculation.staffId.role,
      },
      salaryDetails: {
        baseSalary: salaryCalculation.baseSalary,
        workingDays: salaryCalculation.workingDays,
        attendanceDays: salaryCalculation.attendanceDays,
        leaveDays: salaryCalculation.leaveDays,
        allowances: salaryProfile ? salaryProfile.allowances : [],
        deductions: salaryProfile ? salaryProfile.deductions : [],
        grossSalary: salaryCalculation.grossSalary,
        totalDeductions: salaryCalculation.deductions,
        netPayable: salaryCalculation.netPayable,
      },
      payment: salaryPayment ? {
        amountPaid: salaryPayment.amountPaid,
        paymentMode: salaryPayment.paymentMode,
        paymentDate: salaryPayment.paymentDate,
        paidBy: salaryPayment.paidBy?.name,
      } : null,
      status: salaryCalculation.status,
    };

    res.json({ slip });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Create advance
const createAdvance = async (req, res) => {
  try {
    const { staffId, amount, date, reason } = req.body;
    const { schoolId, _id: givenBy } = req.user;

    if (!staffId || !amount) {
      return res.status(400).json({ message: 'staffId and amount are required' });
    }
    if (amount <= 0) {
      return res.status(400).json({ message: 'Amount must be positive' });
    }

    const staff = await User.findOne({ _id: staffId, schoolId });
    if (!staff) return res.status(404).json({ message: 'Staff not found' });

    const advance = await StaffAdvance.create({
      staffId,
      schoolId,
      amount,
      date: date ? new Date(date) : new Date(),
      reason,
      givenBy,
    });

    await advance.populate('staffId', 'name role');
    res.status(201).json({ message: 'Advance created', data: advance });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get all advances
const getAdvances = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const advances = await StaffAdvance.find({ schoolId })
      .populate('staffId', 'name role')
      .populate('givenBy', 'name')
      .sort({ createdAt: -1 });
    res.json({ data: advances });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  setupSalaryProfile,
  getSalaryProfile,
  calculateSalary,
  getMonthlySalaries,
  paySalary,
  getSalarySlip,
  getSalarySlipPdf,
  getAllStaffList,
  getStaffSlipAdmin,
  createAdvance,
  getAdvances,
};
