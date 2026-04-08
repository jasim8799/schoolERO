const express = require('express');
const { payHostelFee, getHostelFeeHistory } = require('../controllers/hostelFee.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/role.middleware');

const router = express.Router();

router.use(authenticate);
router.post('/pay', requireRole('PRINCIPAL', 'OPERATOR'), payHostelFee);
router.get('/', requireRole('PRINCIPAL', 'OPERATOR'), getHostelFeeHistory);

module.exports = router;
