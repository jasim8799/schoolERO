const express = require('express');
const {
  payManual,
  getPaymentsByStudent,
  initiateOnlinePayment,
  verifyOnlinePayment,
  getMyPayments,
  getReceipt
} = require('../controllers/feePayment.controller.js');
const { authenticate } = require('../middlewares/auth.middleware.js');
const { requireRole } = require('../middlewares/role.middleware.js');
const { checkSchoolStatus } = require('../middlewares/school.middleware.js');
const { checkOnlinePaymentAccess } = require('../middlewares/onlinePayment.middleware.js');

const router = express.Router();

// Manual payment routes (Principal/Operator only)
router.post('/pay/manual', authenticate, requireRole('PRINCIPAL', 'OPERATOR'), payManual);
router.get('/payments/student/:id', authenticate, requireRole('PRINCIPAL', 'OPERATOR'), getPaymentsByStudent);

// Online payment routes (Parents only)
router.post('/pay/online/initiate', authenticate, requireRole('PARENT'), checkOnlinePaymentAccess, initiateOnlinePayment);
router.post('/pay/online/verify', authenticate, requireRole('PRINCIPAL', 'OPERATOR'), verifyOnlinePayment);
router.get('/payments/student/me', authenticate, requireRole('PARENT'), getMyPayments);

// Receipt download (All authenticated users with appropriate access control)
router.get('/receipt/:receiptNo', authenticate, getReceipt);

module.exports = router;
