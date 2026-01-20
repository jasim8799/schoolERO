const express = require('express');
const { authenticate } = require('../middlewares/auth.middleware.js');
const { enforceSchoolIsolation } = require('../middlewares/school.middleware.js');
const { requireRole } = require('../middlewares/role.middleware.js');
const { getStudentAcademicHistory } = require('../controllers/academicHistory.controller.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

router.get('/student/:studentId', authenticate, enforceSchoolIsolation, requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR, USER_ROLES.TEACHER, USER_ROLES.STUDENT, USER_ROLES.PARENT), getStudentAcademicHistory);

module.exports = router;
