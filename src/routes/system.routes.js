const express = require('express');
const { getSystemMetrics, getSystemHealth, getBackupStatus, getMaintenanceMode, toggleMaintenanceMode, createSystemAnnouncement, getSystemAnnouncements, getSystemSettings, updateSystemSettings } = require('../controllers/system.controller');
const { requireRole } = require('../middlewares/role.middleware');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

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

// GET /api/system/settings - Get all system settings
router.get('/settings', getSystemSettings);

// PUT /api/system/settings - Update system settings
router.put('/settings', updateSystemSettings);

// GET /api/system/maintenance - Get maintenance mode status
router.get('/maintenance', getMaintenanceMode);

// PUT /api/system/maintenance - Toggle maintenance mode
router.put('/maintenance', toggleMaintenanceMode);

// POST /api/system/announcements - Create system announcement
router.post('/announcements', createSystemAnnouncement);

module.exports = router;
