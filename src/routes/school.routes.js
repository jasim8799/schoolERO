import express from 'express';
import { createSchool, getAllSchools, getSchoolById, createSchoolWithLifecycle, toggleSchoolStatus, reassignPrincipal, getSchoolLimits, updateSchoolLimits, getSchoolModules, updateSchoolModules, getCurrentUserSchoolModules, updateSchoolPlan, getCurrentUserSchoolSubscription, renewSchoolSubscription, getCurrentUserSchoolOnlinePayments, forceLogoutSchool } from '../controllers/school.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';
import { USER_ROLES } from '../config/constants.js';

const router = express.Router();

// Routes that require authentication but not necessarily SUPER_ADMIN
// GET /api/schools/my/modules - Get current user's school modules (authenticated users)
router.get('/my/modules', authenticate, getCurrentUserSchoolModules);

// GET /api/schools/my/subscription - Get current user's school subscription status (authenticated users)
router.get('/my/subscription', authenticate, getCurrentUserSchoolSubscription);

// GET /api/schools/my/online-payments - Get current user's school online payment status (authenticated users)
router.get('/my/online-payments', authenticate, getCurrentUserSchoolOnlinePayments);

// All other school routes require SUPER_ADMIN authentication
router.use(authenticate);
router.use(requireRole(USER_ROLES.SUPER_ADMIN));

// POST /api/schools - Create school (SUPER_ADMIN only)
router.post('/', createSchool);

// POST /api/schools/lifecycle - Create school with full lifecycle setup (SUPER_ADMIN only)
router.post('/lifecycle', createSchoolWithLifecycle);

// GET /api/schools - Get all schools (SUPER_ADMIN only)
router.get('/', getAllSchools);

// GET /api/schools/:id - Get school by ID
router.get('/:id', getSchoolById);

// PUT /api/schools/:id/status - Activate/Deactivate school (SUPER_ADMIN only)
router.put('/:id/status', toggleSchoolStatus);

// PUT /api/schools/:id/principal - Reassign principal (SUPER_ADMIN only)
router.put('/:id/principal', reassignPrincipal);

// PUT /api/schools/:id/plan - Update school plan (SUPER_ADMIN only)
router.put('/:id/plan', updateSchoolPlan);

// GET /api/schools/:id/limits - Get school limits (SUPER_ADMIN only)
router.get('/:id/limits', getSchoolLimits);

// PUT /api/schools/:id/limits - Update school limits (SUPER_ADMIN only)
router.put('/:id/limits', updateSchoolLimits);

// GET /api/schools/:id/modules - Get school modules (SUPER_ADMIN only)
router.get('/:id/modules', getSchoolModules);

// PUT /api/schools/:id/modules - Update school modules (SUPER_ADMIN only)
router.put('/:id/modules', updateSchoolModules);

// PUT /api/schools/:id/subscription/renew - Renew school subscription (SUPER_ADMIN only)
router.put('/:id/subscription/renew', renewSchoolSubscription);

// POST /api/schools/:id/force-logout - Force logout all users for a school (SUPER_ADMIN only)
router.post('/:id/force-logout', forceLogoutSchool);

export default router;
