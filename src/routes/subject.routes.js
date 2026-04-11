const express = require('express');
const { createSubject, getAllSubjects, getSubjectById } = require('../controllers/subject.controller.js');
const { authenticate } = require('../middlewares/auth.middleware.js');
const { requireMinRole } = require('../middlewares/role.middleware.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

// POST /api/subjects - Create subject (PRINCIPAL, OPERATOR)
router.post('/', authenticate, requireMinRole(USER_ROLES.OPERATOR), createSubject);

// GET /api/subjects - Get all subjects (PRINCIPAL, OPERATOR)
router.get('/', authenticate, requireMinRole(USER_ROLES.TEACHER), getAllSubjects);

// GET /api/subjects/:id - Get subject by ID
router.get('/:id', authenticate, requireMinRole(USER_ROLES.TEACHER), getSubjectById);

module.exports = router;
