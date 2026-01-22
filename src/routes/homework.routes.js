const express = require('express');
const { authenticate } = require('../middlewares/auth.middleware.js');
const { enforceSchoolIsolation } = require('../middlewares/school.middleware.js');
const { requireMinRole } = require('../middlewares/role.middleware.js');
const { createHomework, getHomeworkByClass, getHomeworkForStudent } = require('../controllers/homework.controller.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

// All routes require authentication and school isolation
router.use(authenticate);
router.use(enforceSchoolIsolation);

// POST /api/homework - Create homework (TEACHER, PRINCIPAL, OPERATOR)
router.post('/', requireMinRole(USER_ROLES.OPERATOR), createHomework);

// GET /api/homework/class - Get homework by class (TEACHER, PRINCIPAL, OPERATOR)
router.get('/class', requireMinRole(USER_ROLES.OPERATOR), getHomeworkByClass);

// GET /api/homework/student/me - Get homework for student/parent
router.get('/student/me', requireMinRole(USER_ROLES.PARENT), getHomeworkForStudent);

module.exports = router;
