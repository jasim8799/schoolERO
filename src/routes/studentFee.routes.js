const express = require('express');
const { assignFee, getStudentFees } = require('../controllers/studentFee.controller.js');
const { authenticate } = require('../middlewares/auth.middleware.js');
const { requireRole } = require('../middlewares/role.middleware.js');
const { checkSchoolStatus } = require('../middlewares/school.middleware.js');

const router = express.Router();

// All routes require authentication and school validation
router.use(authenticate);
router.use(checkSchoolStatus);

// Only Principal and Operator can access
router.use(requireRole('PRINCIPAL', 'OPERATOR'));

router.post('/assign', assignFee);
router.get('/student/:id', getStudentFees);

module.exports = router;
