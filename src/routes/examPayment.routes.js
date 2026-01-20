const express = require('express');
const { payExamFee, manualExamPayment, getMyExamPayments } = require('../controllers/examPayment.controller.js');
const { requireRole } = require('../middlewares/role.middleware.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

router.post(
  '/',
  requireRole(USER_ROLES.PARENT, USER_ROLES.STUDENT, USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  payExamFee
);

router.post(
  '/manual',
  requireRole(USER_ROLES.OPERATOR, USER_ROLES.PRINCIPAL),
  manualExamPayment
);

router.get(
  '/student/me',
  requireRole(USER_ROLES.STUDENT, USER_ROLES.PARENT),
  getMyExamPayments
);

module.exports = router;
