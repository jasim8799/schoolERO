const express = require('express');
const { previewRestoreController, executeRestoreController } = require('../controllers/restore.controller');
const { authenticate } = require('../middlewares/auth.middleware');

const router = express.Router();

// All restore routes require authentication
router.use(authenticate);

// Preview restore - validate backup and return info (Super Admin only)
router.post('/preview', previewRestoreController);

// Execute restore - perform actual restore (Super Admin only)
router.post('/execute', executeRestoreController);

module.exports = router;
