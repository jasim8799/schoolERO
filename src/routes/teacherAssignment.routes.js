const express = require('express');
const { createAssignment, getByTeacher, getByClass, deleteAssignment } = require('../controllers/teacherAssignment.controller.js');
const { requireMinRole } = require('../middlewares/role.middleware.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

// POST   /api/teacher-assignments          — create assignment
router.post('/', requireMinRole(USER_ROLES.OPERATOR), createAssignment);

// GET    /api/teacher-assignments?teacherId=  — by teacher
router.get('/', requireMinRole(USER_ROLES.OPERATOR), getByTeacher);

// GET    /api/teacher-assignments/class?classId=&sectionId=  — timetable for class
router.get('/class', requireMinRole(USER_ROLES.OPERATOR), getByClass);

// DELETE /api/teacher-assignments/:id
router.delete('/:id', requireMinRole(USER_ROLES.OPERATOR), deleteAssignment);

module.exports = router;
