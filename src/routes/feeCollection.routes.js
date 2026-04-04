const express = require('express');
const {
  searchStudents,
  getStudentDues,
  collectPayment
} = require('../controllers/feeCollection.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/role.middleware');
const { checkSchoolStatus } = require('../middlewares/school.middleware');

const router = express.Router();
router.use(authenticate);
router.use(checkSchoolStatus);
router.use(requireRole('PRINCIPAL', 'OPERATOR'));

router.get('/search', searchStudents);
router.get('/student/:studentId/dues', getStudentDues);
router.post('/collect', collectPayment);

module.exports = router;
