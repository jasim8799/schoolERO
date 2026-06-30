const express = require('express');
const { authenticate } = require('../middlewares/auth.middleware.js');
const { enforceSchoolIsolation } = require('../middlewares/school.middleware.js');
const { requireRole } = require('../middlewares/role.middleware.js');
const {
	assignTransport,
	getStudentTransport,
	getAllAssignments,
	removeStudentTransport,
	reassignStudentTransport,
	getTransportPaymentSummary,
} = require('../controllers/studentTransport.controller.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

router.post('/assign', authenticate, enforceSchoolIsolation, requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR), assignTransport);
router.get('/', authenticate, enforceSchoolIsolation, requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR), getAllAssignments);
router.get('/summary', authenticate, enforceSchoolIsolation, requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR), getTransportPaymentSummary);
router.get('/student/:id', authenticate, enforceSchoolIsolation, getStudentTransport);
router.patch('/remove/:id', authenticate, enforceSchoolIsolation, requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR), removeStudentTransport);
router.patch('/reassign/:id', authenticate, enforceSchoolIsolation, requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR), reassignStudentTransport);

module.exports = router;
