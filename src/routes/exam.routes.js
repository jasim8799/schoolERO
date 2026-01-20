const express = require('express');
const { createExam, getExamsByClass } = require('../controllers/exam.controller.js');
const { requireRole } = require('../middlewares/role.middleware.js');
const { enforceSchoolIsolation } = require('../middlewares/school.middleware.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

router.post(
  '/',
  enforceSchoolIsolation,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  createExam
);

router.get(
  '/',
  enforceSchoolIsolation,
  requireRole(
    USER_ROLES.PRINCIPAL,
    USER_ROLES.OPERATOR,
    USER_ROLES.TEACHER
  ),
  getExamsByClass
);

module.exports = router;
