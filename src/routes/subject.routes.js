const express = require('express');
const { createSubject, getAllSubjects, getSubjectById } = require('../controllers/subject.controller.js');
const { requireMinRole } = require('../middlewares/role.middleware.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

// POST /api/subjects - Create subject (PRINCIPAL, OPERATOR)
router.post('/', requireMinRole(USER_ROLES.OPERATOR), createSubject);

// GET /api/subjects - Get all subjects (PRINCIPAL, OPERATOR)
router.get('/', requireMinRole(USER_ROLES.OPERATOR), getAllSubjects);

// GET /api/subjects/:id - Get subject by ID
router.get('/:id', requireMinRole(USER_ROLES.OPERATOR), getSubjectById);

module.exports = router;
