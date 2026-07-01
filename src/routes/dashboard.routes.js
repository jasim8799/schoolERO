const express = require('express');
const { getPrincipalDashboard, getOperatorDashboard, getTeacherDashboard, getStudentDashboard, getSuperAdminDashboard, getNavBadges } = require('../controllers/dashboard.controller');
const { requireRole } = require('../middlewares/role.middleware');
const { checkSchoolStatus } = require('../middlewares/school.middleware');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

// Super Admin dashboard (no school validation needed)
router.get('/super-admin', requireRole(USER_ROLES.SUPER_ADMIN), getSuperAdminDashboard);
router.get('/nav-badges', requireRole(USER_ROLES.SUPER_ADMIN), getNavBadges);

// School-specific routes require school validation
router.use(checkSchoolStatus);

// Principal dashboard
router.get('/principal', requireRole(USER_ROLES.PRINCIPAL), getPrincipalDashboard);

// Operator dashboard
router.get('/operator', requireRole(USER_ROLES.OPERATOR), getOperatorDashboard);

// Teacher dashboard
router.get('/teacher', requireRole(USER_ROLES.TEACHER), getTeacherDashboard);

// Student/Parent dashboard
router.get('/student', requireRole(USER_ROLES.STUDENT, USER_ROLES.PARENT), getStudentDashboard);

module.exports = router;
