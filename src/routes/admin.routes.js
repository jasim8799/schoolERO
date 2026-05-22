const express = require('express');
const {
	createSchool,
	getSchoolById,
	createSchoolWithLifecycle,
	toggleSchoolStatus,
	assignPrincipal,
	getSchoolLimits,
	updateSchoolLimits,
	getSchoolModules,
	updateSchoolModules,
	updateSchoolPlan,
	renewSchoolSubscription,
	forceLogoutSchool,
	getAllSchools,
	getSchoolTotals,
	getSchoolAnalytics,
	getSchoolSecuritySummary,
	createOperator,
	createParent,
	createStudent,
	createTeacher
} = require('../controllers/school.controller');
const { getDashboard } = require('../controllers/superAdmin.controller');
const analyticsCtrl = require('../controllers/analytics.controller');
const securityCtrl = require('../controllers/security.controller');
const monitoringCtrl = require('../controllers/monitoring.controller');
const healthCtrl = require('../controllers/health.controller');
const auditCtrl = require('../controllers/audit.controller');
const { migrateParentUserId } = require('../controllers/parent.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/role.middleware');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

// All admin routes require SUPER_ADMIN authentication
router.use(authenticate);
router.use(requireRole(USER_ROLES.SUPER_ADMIN));

// POST /api/admin/schools - Create school (SUPER_ADMIN only)
router.post('/schools', createSchool);

// POST /api/admin/schools/lifecycle - Create school with full lifecycle setup (SUPER_ADMIN only)
router.post('/schools/lifecycle', createSchoolWithLifecycle);

// GET /api/admin/schools - Get all schools (SUPER_ADMIN only)
router.get('/schools', getAllSchools);

// GET /api/admin/schools/totals - Platform-wide totals for schools dashboard cards
router.get('/schools/totals', getSchoolTotals);

// GET /api/admin/dashboard - Aggregated enterprise dashboard metrics
router.get('/dashboard', getDashboard);

// GET /api/admin/schools/:id/analytics - Detailed analytics for school detail panel
router.get('/schools/:id/analytics', getSchoolAnalytics);

// GET /api/admin/schools/:id/security-summary - Detailed security summary for school detail panel
router.get('/schools/:id/security-summary', getSchoolSecuritySummary);

// GET /api/admin/schools/:id - Get school by ID
router.get('/schools/:id', getSchoolById);

// PUT /api/admin/schools/:id/status - Activate/Deactivate school (SUPER_ADMIN only)
router.put('/schools/:id/status', toggleSchoolStatus);

// PUT /api/admin/schools/:id/principal - Assign principal (SUPER_ADMIN only)
router.put('/schools/:id/principal', assignPrincipal);

// PUT /api/admin/schools/:id/plan - Update school plan (SUPER_ADMIN only)
router.put('/schools/:id/plan', updateSchoolPlan);

// GET /api/admin/schools/:id/limits - Get school limits (SUPER_ADMIN only)
router.get('/schools/:id/limits', getSchoolLimits);

// PUT /api/admin/schools/:id/limits - Update school limits (SUPER_ADMIN only)
router.put('/schools/:id/limits', updateSchoolLimits);

// GET /api/admin/schools/:id/modules - Get school modules (SUPER_ADMIN only)
router.get('/schools/:id/modules', getSchoolModules);

// PUT /api/admin/schools/:id/modules - Update school modules (SUPER_ADMIN only)
router.put('/schools/:id/modules', updateSchoolModules);

// PUT /api/admin/schools/:id/subscription/renew - Renew school subscription (SUPER_ADMIN only)
router.put('/schools/:id/subscription/renew', renewSchoolSubscription);

// POST /api/admin/schools/:id/force-logout - Force logout all users for a school (SUPER_ADMIN only)
router.post('/schools/:id/force-logout', forceLogoutSchool);

// POST /api/admin/schools/:id/operator - Create operator for school (SUPER_ADMIN only)
router.post('/schools/:id/operator', createOperator);

// POST /api/admin/schools/:id/parent - Create parent for school (SUPER_ADMIN only)
router.post('/schools/:id/parent', createParent);

// POST /api/admin/schools/:id/student - Create student for school (SUPER_ADMIN only)
router.post('/schools/:id/student', createStudent);

// POST /api/admin/schools/:id/teacher - Create teacher for school (SUPER_ADMIN only)
router.post('/schools/:id/teacher', createTeacher);

// POST /api/admin/migrate-parent-user-id - Migrate parentUserId for existing students (SUPER_ADMIN only)
router.post('/migrate-parent-user-id', migrateParentUserId);

// Analytics
router.get('/analytics/overview', analyticsCtrl.getOverview);
router.get('/analytics/revenue', analyticsCtrl.getRevenueAnalytics);
router.get('/analytics/attendance', analyticsCtrl.getAttendanceAnalytics);
router.get('/analytics/schools/:id', analyticsCtrl.getSchoolAnalytics);

// Health
router.get('/health/schools', healthCtrl.getAllSchoolsHealth);
router.get('/health/schools/:id', healthCtrl.getSchoolHealth);
router.get('/health/schools/:id/history', healthCtrl.getSchoolHealthHistory);
router.post('/health/schools/:id/rescan', healthCtrl.rescanSchoolHealth);

// Security
router.get('/security/logs', securityCtrl.getSecurityLogs);
router.get('/security/logs/:schoolId', securityCtrl.getSchoolSecurityLogs);
router.get('/security/sessions', securityCtrl.getActiveSessions);
router.post('/security/revoke-session', securityCtrl.revokeSession);
router.post('/security/block-ip', securityCtrl.blockIP);

// Monitoring
router.get('/monitoring/infrastructure', monitoringCtrl.getInfraMetrics);
router.get('/monitoring/live', monitoringCtrl.getLiveMetrics);
router.get('/monitoring/queue', monitoringCtrl.getJobQueueStatus);

// Audit
router.get('/audit/logs', auditCtrl.getAuditLogsController);
router.get('/audit/stats', auditCtrl.getAuditStatsController);

module.exports = router;
