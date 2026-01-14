const express = require('express');
const { downloadBackupController } = require('../controllers/backup_download.controller');
const { authenticate } = require('../middlewares/auth.middleware');

const router = express.Router();

// All backup routes require authentication
router.use(authenticate);

// Download backup (Principal only)
router.post('/download', downloadBackupController);

module.exports = router;
