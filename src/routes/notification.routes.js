const express = require('express');
const {
  getQueue,
  processSend,
  sendManual,
  getSystemAlerts
} = require('../controllers/notification.controller');
const { requireMinRole } = require('../middlewares/role.middleware');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

// View notification queue
router.get('/queue', requireMinRole(USER_ROLES.OPERATOR), getQueue);

// Process and send PENDING notifications (batch)
router.post('/send', requireMinRole(USER_ROLES.PRINCIPAL), processSend);

// Send a manual ad-hoc notification
router.post('/manual', requireMinRole(USER_ROLES.OPERATOR), sendManual);

// Super admin live alerts for the layout
router.get('/alerts', requireMinRole(USER_ROLES.SUPER_ADMIN), getSystemAlerts);

module.exports = router;
