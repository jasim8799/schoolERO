const express = require('express');
const router  = express.Router();

const { authenticate }  = require('../middlewares/auth.middleware');
const { requireRole }   = require('../middlewares/role.middleware');
const { USER_ROLES }    = require('../config/constants');
const admissionCtrl     = require('../controllers/admission.controller');

// Create admission record  — PRINCIPAL or OPERATOR only
router.post(
  '/',
  authenticate,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  admissionCtrl.createAdmission
);

// Get admission record for a student — PRINCIPAL, OPERATOR, or TEACHER
router.get(
  '/student/:studentId',
  authenticate,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR, USER_ROLES.TEACHER),
  admissionCtrl.getAdmissionByStudent
);

module.exports = router;
