const express = require('express');
const { assignFee, getStudentFees } = require('../controllers/studentFee.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { authorizeRoles } = require('../middlewares/role.middleware');
const { validateSchool } = require('../middlewares/school.middleware');

const router = express.Router();

// All routes require authentication and school validation
router.use(authenticate);
router.use(validateSchool);

// Only Principal and Operator can access
router.use(authorizeRoles('PRINCIPAL', 'OPERATOR'));

router.post('/assign', assignFee);
router.get('/student/:id', getStudentFees);

module.exports = router;
