const express = require('express');
const { getBackupStatusController, triggerManualBackupController } = require('../controllers/backup.controller');
const { authenticate } = require('../middlewares/auth.middleware');

const router = express.Router();

// All backup routes require authentication
router.use(authenticate);

// Get backup status (Super Admin only)
router.get('/status', getBackupStatusController);

// Trigger manual backup (Super Admin only)
router.post('/manual', triggerManualBackupController);

module.exports = router;
