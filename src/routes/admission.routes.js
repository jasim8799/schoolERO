const express = require('express');
const router  = express.Router();

const { requireAuth }   = require('../middlewares/auth');
const { requireRole }   = require('../middlewares/rbac');
const { USER_ROLES }    = require('../config/roles');
const admissionCtrl     = require('../controllers/admission.controller');

// Create admission record  — PRINCIPAL or OPERATOR only
router.post(
  '/',
  requireAuth,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  admissionCtrl.createAdmission
);

// Get admission record for a student — PRINCIPAL, OPERATOR, or TEACHER
router.get(
  '/student/:studentId',
  requireAuth,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR, USER_ROLES.TEACHER),
  admissionCtrl.getAdmissionByStudent
);

module.exports = router;
