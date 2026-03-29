const express = require('express');
const {
  advanceSession,
  getStudentLifecycle,
  promotionCheck,
  tcCheck
} = require('../controllers/lifecycle.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireMinRole } = require('../middlewares/role.middleware');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

router.use(authenticate);

// Advance academic session lifecycle
router.patch('/session/:id', requireMinRole(USER_ROLES.PRINCIPAL), advanceSession);

// Get student admission/lifecycle status
router.get('/student/:id', requireMinRole(USER_ROLES.OPERATOR), getStudentLifecycle);

// Validate if student is eligible for promotion
// GET /api/lifecycle/promotion-check/:id?sessionId=<id>
router.get('/promotion-check/:id', requireMinRole(USER_ROLES.OPERATOR), promotionCheck);

// Validate if a TC may be issued
router.get('/tc-check/:id', requireMinRole(USER_ROLES.OPERATOR), tcCheck);

module.exports = router;
