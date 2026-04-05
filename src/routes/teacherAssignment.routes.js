const express = require('express');
const { createAssignment, getByTeacher, getByClass, getAllBySchool, publishTimetable, deleteAssignment, getMyTimetable, getStudentClassTimetable } = require('../controllers/teacherAssignment.controller.js');
const { requireMinRole, requireRole } = require('../middlewares/role.middleware.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

// POST   /api/teacher-assignments          — create assignment
router.post('/', requireMinRole(USER_ROLES.OPERATOR), createAssignment);

// POST   /api/teacher-assignments/publish  — publish timetable for the school
router.post('/publish', requireMinRole(USER_ROLES.OPERATOR), publishTimetable);

// GET    /api/teacher-assignments/all      — all assignments for the school
router.get('/all', requireMinRole(USER_ROLES.OPERATOR), getAllBySchool);

// GET    /api/teacher-assignments/my       — teacher: own published timetable
router.get('/my', requireRole(USER_ROLES.TEACHER), getMyTimetable);

// GET    /api/teacher-assignments/student/me — student: published class timetable
router.get('/student/me', requireRole(USER_ROLES.STUDENT), getStudentClassTimetable);

// GET    /api/teacher-assignments?teacherId=  — by teacher
router.get('/', requireMinRole(USER_ROLES.OPERATOR), getByTeacher);

// GET    /api/teacher-assignments/class?classId=&sectionId=  — timetable for class
router.get('/class', requireMinRole(USER_ROLES.OPERATOR), getByClass);

// DELETE /api/teacher-assignments/:id
router.delete('/:id', requireMinRole(USER_ROLES.OPERATOR), deleteAssignment);

module.exports = router;
