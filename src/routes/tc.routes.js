const express = require('express');
const { authenticate } = require('../middlewares/auth.middleware.js');
const { enforceSchoolIsolation } = require('../middlewares/school.middleware.js');
const { requireRole } = require('../middlewares/role.middleware.js');
const { issueTC, getStudentTC, downloadTCPDF, getStudentsWithTC } = require('../controllers/tc.controller.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

router.get('/students-with-tc', authenticate, enforceSchoolIsolation, requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR), getStudentsWithTC);
router.post('/issue', authenticate, enforceSchoolIsolation, requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR), issueTC);
router.get('/student/:studentId', authenticate, enforceSchoolIsolation, requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR, USER_ROLES.STUDENT, USER_ROLES.PARENT), getStudentTC);
router.get('/student/:studentId/pdf', authenticate, enforceSchoolIsolation, requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR, USER_ROLES.STUDENT, USER_ROLES.PARENT), downloadTCPDF);

module.exports = router;
