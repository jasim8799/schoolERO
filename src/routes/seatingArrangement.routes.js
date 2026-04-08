const express = require('express');
const { saveArrangement, getArrangement } = require('../controllers/seatingArrangement.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/role.middleware');

const router = express.Router();

router.use(authenticate);
router.post('/', requireRole('PRINCIPAL', 'OPERATOR'), saveArrangement);
router.get('/:examId', requireRole('PRINCIPAL', 'OPERATOR', 'TEACHER'), getArrangement);

module.exports = router;
