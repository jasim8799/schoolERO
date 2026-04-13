const express = require('express');
const {
  applyLeave,
  getMyLeaveApplications,
  getAllLeaveApplications,
  reviewLeaveApplication,
} = require('../controllers/leave.controller.js');
const { authenticate } = require('../middlewares/auth.middleware.js');
const { requireMinRole } = require('../middlewares/role.middleware.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

router.post('/', authenticate, requireMinRole(USER_ROLES.STUDENT), applyLeave);
router.get('/my', authenticate, requireMinRole(USER_ROLES.STUDENT), getMyLeaveApplications);
router.get('/all', authenticate, requireMinRole(USER_ROLES.OPERATOR), getAllLeaveApplications);
router.patch('/:id/review', authenticate, requireMinRole(USER_ROLES.OPERATOR), reviewLeaveApplication);

module.exports = router;
