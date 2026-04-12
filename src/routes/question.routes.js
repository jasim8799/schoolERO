const express = require('express');
const { authenticate } = require('../middlewares/auth.middleware.js');
const { enforceSchoolIsolation } = require('../middlewares/school.middleware.js');
const { requireRole } = require('../middlewares/role.middleware.js');
const {
  askQuestion,
  getMyQuestions,
  getTeacherQuestions,
  answerQuestion,
  getAllQuestions,
} = require('../controllers/question.controller.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

router.use(authenticate);
router.use(enforceSchoolIsolation);

router.post('/', requireRole(USER_ROLES.STUDENT, USER_ROLES.PARENT), askQuestion);
router.get('/my', requireRole(USER_ROLES.STUDENT, USER_ROLES.PARENT), getMyQuestions);
router.get('/teacher', requireRole(USER_ROLES.TEACHER), getTeacherQuestions);
router.patch('/:id/answer', requireRole(USER_ROLES.TEACHER), answerQuestion);
router.get('/all', requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR), getAllQuestions);

module.exports = router;
