const express = require('express');
const {
  saveQuestionPaper,
  submitQuestionPaper,
  getMyQuestionPaper,
  getQuestionPapersByExam,
  getQuestionPaperDetail,
} = require('../controllers/examQuestionPaper.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/role.middleware');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();
router.use(authenticate);

router.get(
  '/exam/:examId',
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  getQuestionPapersByExam
);

router.get(
  '/detail/:paperId',
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  getQuestionPaperDetail
);

router.post('/', requireRole(USER_ROLES.TEACHER), saveQuestionPaper);

router.get(
  '/:examId/:subjectId/my',
  requireRole(USER_ROLES.TEACHER),
  getMyQuestionPaper
);

router.patch(
  '/:examId/:subjectId/submit',
  requireRole(USER_ROLES.TEACHER),
  submitQuestionPaper
);

module.exports = router;
