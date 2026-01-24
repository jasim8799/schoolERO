const express = require('express');
const { authenticate } = require('../middlewares/auth.middleware.js');
const { enforceSchoolIsolation } = require('../middlewares/school.middleware.js');
const { requireRole } = require('../middlewares/role.middleware.js');
const { createLeave, approveLeave, getLeaves, getHostelFees } = require('../controllers/hostelLeave.controller.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

router.post('/leaves', authenticate, enforceSchoolIsolation, createLeave);
router.put('/leaves/approve/:id', authenticate, enforceSchoolIsolation, requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR), approveLeave);
router.get('/leaves/student/:id', authenticate, enforceSchoolIsolation, getLeaves);
router.get('/fees/student/:id', authenticate, enforceSchoolIsolation, getHostelFees);

module.exports = router;
