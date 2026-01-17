const express = require('express');
const { createClass, getAllClasses, getClassById } = require('../controllers/class.controller.js');
const { authenticate } = require('../middlewares/auth.middleware.js');
const { requireMinRole } = require('../middlewares/role.middleware.js');
const { attachSchoolId } = require('../middlewares/school.middleware.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

// Authenticate user
router.use(authenticate);

// Attach schoolId from JWT (CRITICAL)
router.use(attachSchoolId);

// POST /api/classes - Create class (SUPER_ADMIN, PRINCIPAL, OPERATOR)
router.post('/', requireMinRole(USER_ROLES.OPERATOR), createClass);

// GET /api/classes - Get all classes (SUPER_ADMIN, PRINCIPAL, OPERATOR)
router.get('/', requireMinRole(USER_ROLES.OPERATOR), getAllClasses);

// GET /api/classes/:id - Get class by ID
router.get('/:id', requireMinRole(USER_ROLES.OPERATOR), getClassById);

module.exports = router;
