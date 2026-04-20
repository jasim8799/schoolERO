const express = require('express');
const {
  previewPromotion,
  executePromotion,
  executeAllPromotion
} = require('../controllers/promotion.controller.js');
const { authenticate } = require('../middlewares/auth.middleware.js');
const { requireRole } = require('../middlewares/role.middleware.js');
const { enforceSchoolIsolation } = require('../middlewares/school.middleware.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

router.post(
  '/preview',
  authenticate,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  previewPromotion
);

router.post(
  '/execute',
  authenticate,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  executePromotion
);

router.post(
  '/execute-all',
  authenticate,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  executeAllPromotion
);

module.exports = router;
