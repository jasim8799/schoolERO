import express from 'express';
import { getSystemMetrics, getSystemHealth, getBackupStatus, getMaintenanceMode, toggleMaintenanceMode, createSystemAnnouncement, getSystemAnnouncements } from '../controllers/system.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';
import { USER_ROLES } from '../config/constants.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Public system routes (all authenticated users)
router.get('/announcements', getSystemAnnouncements);

// SUPER_ADMIN only routes
router.use(requireRole(USER_ROLES.SUPER_ADMIN));

// GET /api/system/metrics - Get system-wide metrics
router.get('/metrics', getSystemMetrics);

// GET /api/system/health - Get system health status
router.get('/health', getSystemHealth);

// GET /api/system/backup-status - Get backup status summary
router.get('/backup-status', getBackupStatus);

// GET /api/system/maintenance - Get maintenance mode status
router.get('/maintenance', getMaintenanceMode);

// PUT /api/system/maintenance - Toggle maintenance mode
router.put('/maintenance', toggleMaintenanceMode);

// POST /api/system/announcements - Create system announcement
router.post('/announcements', createSystemAnnouncement);

export default router;
