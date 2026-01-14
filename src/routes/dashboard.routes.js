const express = require('express');
const { getPrincipalDashboard, getOperatorDashboard, getTeacherDashboard, getStudentDashboard, getSuperAdminDashboard } = require('../controllers/dashboard.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/role.middleware');
const { validateSchool } = require('../middlewares/school.middleware');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Super Admin dashboard (no school validation needed)
router.get('/super-admin', requireRole(USER_ROLES.SUPER_ADMIN), getSuperAdminDashboard);

// School-specific routes require school validation
router.use(validateSchool);

// Principal dashboard
router.get('/principal', getPrincipalDashboard);

// Operator dashboard
router.get('/operator', getOperatorDashboard);

// Teacher dashboard
router.get('/teacher', getTeacherDashboard);

// Student/Parent dashboard
router.get('/student', getStudentDashboard);

module.exports = router;
