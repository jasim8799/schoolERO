const express = require('express');
const { setupSalaryProfile, getSalaryProfile, calculateSalary, getMonthlySalaries, paySalary, getSalarySlip } = require('../controllers/salary.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { authorizeRoles } = require('../middlewares/role.middleware');
const { validateSchool } = require('../middlewares/school.middleware');

const router = express.Router();

// All routes require authentication and school validation
router.use(authenticate);
router.use(validateSchool);

// Setup salary profile - Only Principal and Operator
router.post('/setup', authorizeRoles('PRINCIPAL', 'OPERATOR'), setupSalaryProfile);

// Get salary profile - Principal, Operator, and staff (with restrictions)
router.get('/staff/:id', authorizeRoles('PRINCIPAL', 'OPERATOR', 'TEACHER'), getSalaryProfile);

// Calculate salary - Only Principal and Operator
router.post('/calculate', authorizeRoles('PRINCIPAL', 'OPERATOR'), calculateSalary);

// Get monthly salary calculations - Only Principal and Operator
router.get('/monthly', authorizeRoles('PRINCIPAL', 'OPERATOR'), getMonthlySalaries);

// Pay salary - Only Principal and Operator
router.post('/pay', authorizeRoles('PRINCIPAL', 'OPERATOR'), paySalary);

// Get salary slip - All authenticated users (staff see only their own)
router.get('/slip/:month', getSalarySlip);

module.exports = router;
