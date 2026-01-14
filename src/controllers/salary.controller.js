const SalaryProfile = require('../models/SalaryProfile');
const SalaryCalculation = require('../models/SalaryCalculation');
const SalaryPayment = require('../models/SalaryPayment');
const User = require('../models/User');
const TeacherAttendance = require('../models/TeacherAttendance');
const { USER_ROLES } = require('../config/constants');

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
    const staffRoles = [USER_ROLES.TEACHER, USER_ROLES.OPERATOR, USER_ROLES.PRINCIPAL];
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

// Calculate salary for a staff member
const calculateSalary = async (req, res) => {
  try {
    const { staffId, month } = req.body;
    const { schoolId } = req.user;

    // Validate required fields
    if (!staffId || !month) {
      return res.status(400).json({ message: 'staffId and month are required' });
    }

    // Validate month format
    const monthRegex = /^\d{4}-\d{2}$/;
    if (!monthRegex.test(month)) {
      return res.status(400).json({ message: 'Invalid month format. Use YYYY-MM' });
    }

    // Check if staff exists and is a staff member
    const staff = await User.findById(staffId);
    if (!staff) {
      return res.status(404).json({ message: 'Staff not found' });
    }

    if (staff.schoolId.toString() !== schoolId.toString()) {
      return res.status(403).json({ message: 'Staff does not belong to this school' });
    }

    const staffRoles = [USER_ROLES.TEACHER, USER_ROLES.OPERATOR, USER_ROLES.PRINCIPAL];
    if (!staffRoles.includes(staff.role)) {
      return res.status(400).json({ message: 'User is not a staff member' });
    }

    // Check if salary profile exists
    const salaryProfile = await SalaryProfile.findOne({ userId: staffId, schoolId });
    if (!salaryProfile) {
      return res.status(404).json({ message: 'Salary profile not found for this staff member' });
    }

    // Check if calculation already exists
    const existingCalculation = await SalaryCalculation.findOne({ staffId, month, schoolId });
    if (existingCalculation) {
      return res.status(409).json({ message: 'Salary calculation already exists for this staff and month' });
    }

    // Calculate working days (days in month)
    const [year, monthNum] = month.split('-');
    const workingDays = new Date(year, monthNum, 0).getDate();

    // Get attendance days (count of PRESENT records)
    const attendanceCount = await TeacherAttendance.countDocuments({
      teacherId: staffId,
      schoolId,
      date: { $regex: `^${month}` },
      status: 'PRESENT'
    });

    const attendanceDays = attendanceCount;
    const leaveDays = 0; // No leave model, so 0

    // Calculate salary
    const perDay = salaryProfile.baseSalary / workingDays;
    const earned = perDay * attendanceDays;

    const allowancesTotal = salaryProfile.allowances.reduce((sum, allowance) => sum + allowance.amount, 0);
    const grossSalary = earned + allowancesTotal;

    const deductionsTotal = salaryProfile.deductions.reduce((sum, deduction) => sum + deduction.amount, 0);
    const netPayable = Math.max(0, grossSalary - deductionsTotal);

    // Create salary calculation
    const salaryCalculation = await SalaryCalculation.create({
      staffId,
      month,
      baseSalary: salaryProfile.baseSalary,
      attendanceDays,
      workingDays,
      leaveDays,
      grossSalary,
      deductions: deductionsTotal,
      netPayable,
      schoolId
    });

    // Populate staff details
    await salaryCalculation.populate('staffId', 'name email mobile role');

    res.status(201).json({
      message: 'Salary calculated successfully',
      salaryCalculation
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

    // Validate paymentMode
    if (!['Cash', 'Bank'].includes(paymentMode)) {
      return res.status(400).json({ message: 'Invalid paymentMode. Must be Cash or Bank' });
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
      paymentMode,
      paidBy,
      schoolId
    });

    // Update salary calculation status to Paid
    salaryCalculation.status = 'Paid';
    await salaryCalculation.save();

    // Populate payment details
    await salaryPayment.populate('paidBy', 'name');

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

module.exports = {
  setupSalaryProfile,
  getSalaryProfile,
  calculateSalary,
  getMonthlySalaries,
  paySalary,
  getSalarySlip
};
