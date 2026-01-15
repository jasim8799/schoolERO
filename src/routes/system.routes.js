const express = require('express');
const { getSystemMetrics, getSystemHealth, getBackupStatus, getMaintenanceMode, toggleMaintenanceMode, createSystemAnnouncement, getSystemAnnouncements } = require('../controllers/system.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/role.middleware');
const { USER_ROLES } = require('../config/constants');

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

module.exports = router;
