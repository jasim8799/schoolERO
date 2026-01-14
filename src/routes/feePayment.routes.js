const express = require('express');
const {
  payManual,
  getPaymentsByStudent,
  initiateOnlinePayment,
  verifyOnlinePayment,
  getMyPayments,
  getReceipt
} = require('../controllers/feePayment.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/role.middleware');
const { validateSchool } = require('../middlewares/school.middleware');
const { checkOnlinePaymentAccess } = require('../middlewares/onlinePayment.middleware');

const router = express.Router();

// All routes require authentication and school validation
router.use(authenticate);
router.use(validateSchool);

// Manual payment routes (Principal/Operator only)
router.post('/pay/manual', requireRole('PRINCIPAL', 'OPERATOR'), payManual);
router.get('/payments/student/:id', requireRole('PRINCIPAL', 'OPERATOR'), getPaymentsByStudent);

// Online payment routes (Parents only)
router.post('/pay/online/init', requireRole('PARENT'), checkOnlinePaymentAccess, initiateOnlinePayment);
router.post('/pay/online/verify', requireRole('PRINCIPAL', 'OPERATOR'), verifyOnlinePayment);
router.get('/payments/student/me', requireRole('PARENT'), getMyPayments);

// Receipt download (All authenticated users with appropriate access control)
router.get('/receipt/:receiptNo', getReceipt);

module.exports = router;
