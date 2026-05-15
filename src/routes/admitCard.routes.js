const express = require('express');
const {
  generateAdmitCard,
  bulkGenerateAdmitCards,
  getMyAdmitCard,
  getAdmitCardPDF,
  getAdmitCardsByExam,
  getMyAdmitCardByExamId,
  publishAdmitCard,
} = require('../controllers/admitCard.controller.js');
const { requireRole } = require('../middlewares/role.middleware.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

// -- Specific named routes FIRST (before param routes) ----------------------

// POST
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

// GET named routes (must come before /:id routes)
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

// -- Param routes LAST (:id can match anything) -----------------------------
router.get(
  '/:id/pdf',
  requireRole(
    USER_ROLES.PRINCIPAL,
    USER_ROLES.OPERATOR,
    USER_ROLES.STUDENT,
    USER_ROLES.PARENT,
  ),
  getAdmitCardPDF
);

// PATCH /:id/publish -- individual card release
router.patch(
  '/:id/publish',
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  publishAdmitCard
);

module.exports = router;
