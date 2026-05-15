const express = require('express');
const { generateAdmitCard, bulkGenerateAdmitCards, getMyAdmitCard, getAdmitCardPDF, getAdmitCardsByExam, getMyAdmitCardByExamId, publishAdmitCard } = require('../controllers/admitCard.controller.js');
const { requireRole } = require('../middlewares/role.middleware.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

router.post(
  '/generate',
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  generateAdmitCard
);

router.post(
  '/bulk-generate',
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  bulkGenerateAdmitCards
);

router.patch(
  '/:id/publish',
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  publishAdmitCard
);

router.get(
  '/exam/:examId',
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  getAdmitCardsByExam
);

router.get(
  '/student/me/:examId',
  requireRole(USER_ROLES.STUDENT, USER_ROLES.PARENT),
  getMyAdmitCardByExamId
);

router.get(
  '/student/me',
  requireRole(USER_ROLES.STUDENT, USER_ROLES.PARENT),
  getMyAdmitCard
);

router.get(
  '/:id/pdf',
  getAdmitCardPDF
);

module.exports = router;
