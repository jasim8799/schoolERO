const express = require('express');
const { createFeeStructure, getFeeStructures } = require('../controllers/feeStructure.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/role.middleware');
const { validateSchool } = require('../middlewares/school.middleware');

const router = express.Router();

// All routes require authentication and school validation
router.use(authenticate);
router.use(validateSchool);

// Only Principal and Operator can access
router.use(requireRole('PRINCIPAL', 'OPERATOR'));

router.post('/', createFeeStructure);
router.get('/', getFeeStructures);

module.exports = router;
