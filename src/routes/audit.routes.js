const express = require('express');
const { getAuditLogsController, getAuditStatsController } = require('../controllers/audit.controller');
const { authenticate } = require('../middlewares/auth.middleware');

const router = express.Router();

// All audit routes require authentication
router.use(authenticate);

// Get audit logs (Principal and Super Admin only)
router.get('/', getAuditLogsController);

// Alias route for logs
router.get('/logs', getAuditLogsController);

// Get audit statistics (Super Admin only)
router.get('/stats', getAuditStatsController);

module.exports = router;
