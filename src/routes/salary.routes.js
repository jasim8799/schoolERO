const express = require('express');
const {
  setupSalaryProfile, getSalaryProfile, calculateSalary,
  getMonthlySalaries, paySalary, getSalarySlip, getSalarySlipPdf,
  getAllStaffList, getStaffSlipAdmin, createAdvance, getAdvances,
} = require('../controllers/salary.controller.js');
const { authenticate } = require('../middlewares/auth.middleware.js');
const { requireRole } = require('../middlewares/role.middleware.js');
const { checkSchoolStatus } = require('../middlewares/school.middleware.js');

const router = express.Router();

// All routes require authentication and school validation
router.use(authenticate);
router.use(checkSchoolStatus);

// Setup salary profile - Only Principal and Operator
router.post('/setup', requireRole('PRINCIPAL', 'OPERATOR'), setupSalaryProfile);

// Get all staff list - Principal and Operator
router.get('/staff-list', requireRole('PRINCIPAL', 'OPERATOR'), getAllStaffList);

// Get salary profile - Principal, Operator, and staff (with restrictions)
router.get('/staff/:id', requireRole('PRINCIPAL', 'OPERATOR', 'TEACHER'), getSalaryProfile);

// Calculate salary - Only Principal and Operator
router.post('/calculate', requireRole('PRINCIPAL', 'OPERATOR'), calculateSalary);

// Get monthly salary calculations - Only Principal and Operator
router.get('/monthly', requireRole('PRINCIPAL', 'OPERATOR'), getMonthlySalaries);

// Pay salary - Only Principal and Operator
router.post('/pay', requireRole('PRINCIPAL', 'OPERATOR'), paySalary);

// Advances
router.post('/advance', requireRole('PRINCIPAL', 'OPERATOR'), createAdvance);
router.get('/advances', requireRole('PRINCIPAL', 'OPERATOR'), getAdvances);

// Admin view any staff slip
router.get('/slip/:staffId/:month', requireRole('PRINCIPAL', 'OPERATOR'), getStaffSlipAdmin);

// Get salary slip - All authenticated users (staff see only their own)
router.get('/slip/:month', getSalarySlip);

// Download salary slip as PDF - All authenticated users (staff see only their own)
router.get('/slip/:month/pdf', getSalarySlipPdf);

module.exports = router;
