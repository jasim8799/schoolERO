const express = require('express');
const { createFeeStructure, getFeeStructures } = require('../controllers/feeStructure.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { validateSchool } = require('../middlewares/school.middleware');
const { USER_ROLES, HTTP_STATUS } = require('../config/constants');

const router = express.Router();

// Middleware to check if user has Principal or Operator role
const requirePrincipalOrOperator = (req, res, next) => {
  if (!req.user) {
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({
      success: false,
      message: 'Authentication required'
    });
  }

  const userRole = req.user.role;
  if (userRole !== USER_ROLES.PRINCIPAL && userRole !== USER_ROLES.OPERATOR) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({
      success: false,
      message: 'Access denied. Insufficient permissions.'
    });
  }

  next();
};

// All routes require authentication and school validation
router.use(authenticate);
router.use(validateSchool);

// Only Principal and Operator can access
router.use(requirePrincipalOrOperator);

router.post('/', createFeeStructure);
router.get('/', getFeeStructures);

module.exports = router;
