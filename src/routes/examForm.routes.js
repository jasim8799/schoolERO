const express = require('express');
const { createExamForm, getActiveExamForms } = require('../controllers/examForm.controller.js');
const { requireRole } = require('../middlewares/role.middleware.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

router.post(
  '/',
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  createExamForm
);

router.get(
  '/active',
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR, USER_ROLES.TEACHER, USER_ROLES.STUDENT, USER_ROLES.PARENT),
  getActiveExamForms
);

module.exports = router;
