const express = require('express');
const { authenticate } = require('../middlewares/auth.middleware.js');
const { enforceSchoolIsolation } = require('../middlewares/school.middleware.js');
const { requireRole } = require('../middlewares/role.middleware.js');
const { assignTransport, getStudentTransport } = require('../controllers/studentTransport.controller.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

router.post('/assign', authenticate, enforceSchoolIsolation, requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR), assignTransport);
router.get('/student/:id', authenticate, enforceSchoolIsolation, getStudentTransport);

module.exports = router;
