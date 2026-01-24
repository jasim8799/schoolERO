const express = require('express');
const { authenticate } = require('../middlewares/auth.middleware.js');
const { enforceSchoolIsolation } = require('../middlewares/school.middleware.js');
const { requireRole } = require('../middlewares/role.middleware.js');
const { assignHostel, getStudentHostel } = require('../controllers/studentHostel.controller.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

router.post('/assign', authenticate, enforceSchoolIsolation, requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR), assignHostel);
router.get('/student/:id', authenticate, enforceSchoolIsolation, getStudentHostel);

module.exports = router;
