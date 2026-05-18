const express = require('express');
const { getBackupStatusController, triggerManualBackupController, getBackupListController } = require('../controllers/backup.controller');
const { authenticate } = require('../middlewares/auth.middleware');

const router = express.Router();

// All backup routes require authentication
router.use(authenticate);

// Get backup status (Super Admin only)
router.get('/status', getBackupStatusController);

// GET /api/backup/list - Get backup list with filters
router.get('/list', getBackupListController);

// Trigger manual backup (Super Admin only)
router.post('/manual', triggerManualBackupController);

module.exports = router;
