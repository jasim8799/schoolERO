const express = require('express');
const {
  getQueue,
  processSend,
  sendManual
} = require('../controllers/notification.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireMinRole } = require('../middlewares/role.middleware');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

router.use(authenticate);

// View notification queue
router.get('/queue', requireMinRole(USER_ROLES.OPERATOR), getQueue);

// Process and send PENDING notifications (batch)
router.post('/send', requireMinRole(USER_ROLES.PRINCIPAL), processSend);

// Send a manual ad-hoc notification
router.post('/manual', requireMinRole(USER_ROLES.OPERATOR), sendManual);

module.exports = router;
