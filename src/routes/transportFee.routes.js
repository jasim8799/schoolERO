const express = require('express');
const { authenticate } = require('../middlewares/auth.middleware.js');
const { enforceSchoolIsolation } = require('../middlewares/school.middleware.js');
const { requireRole } = require('../middlewares/role.middleware.js');
const { getAllFees, payFee } = require('../controllers/transportFee.controller.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

router.get('/', authenticate, enforceSchoolIsolation, getAllFees);
router.post('/pay', authenticate, enforceSchoolIsolation,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR), payFee);

module.exports = router;
