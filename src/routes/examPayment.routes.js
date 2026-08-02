const express = require('express');
const { payExamFee, manualExamPayment, getMyExamPayments, getAllExamPayments, getExamPaymentStatus } = require('../controllers/examPayment.controller.js');
const { requireRole } = require('../middlewares/role.middleware.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

// GET all payments (OPERATOR / PRINCIPAL)
router.get(
  '/',
  requireRole(USER_ROLES.OPERATOR, USER_ROLES.PRINCIPAL, USER_ROLES.SUPER_ADMIN),
  getAllExamPayments
);

router.get(
  '/status',
  requireRole(USER_ROLES.OPERATOR, USER_ROLES.PRINCIPAL, USER_ROLES.SUPER_ADMIN),
  getExamPaymentStatus
);

router.post(
  '/',
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR, USER_ROLES.SUPER_ADMIN),
  payExamFee
);

router.post(
  '/manual',
  requireRole(USER_ROLES.OPERATOR, USER_ROLES.PRINCIPAL, USER_ROLES.SUPER_ADMIN),
  manualExamPayment
);

router.get(
  '/student/me',
  requireRole(USER_ROLES.STUDENT, USER_ROLES.PARENT),
  getMyExamPayments
);

module.exports = router;
