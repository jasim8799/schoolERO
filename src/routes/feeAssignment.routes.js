const express = require('express');
const {
  generateMonthly,
  getStudentAssignments,
  waiveAssignment
} = require('../controllers/feeAssignment.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireMinRole } = require('../middlewares/role.middleware');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

router.use(authenticate);

// Generate monthly fees for all active students in the school
router.post('/generate-monthly', requireMinRole(USER_ROLES.OPERATOR), generateMonthly);

// Get all fee assignments for a specific student
router.get('/student/:id', requireMinRole(USER_ROLES.OPERATOR), getStudentAssignments);

// Waive a specific fee assignment
router.patch('/:id/waive', requireMinRole(USER_ROLES.PRINCIPAL), waiveAssignment);

module.exports = router;
