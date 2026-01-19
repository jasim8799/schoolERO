const express = require('express');
const {
  payManual,
  getPaymentsByStudent,
  initiateOnlinePayment,
  verifyOnlinePayment,
  getMyPayments,
  getReceipt
} = require('../controllers/feePayment.controller.js');

const { checkOnlinePaymentAccess } = require('../middlewares/onlinePayment.middleware.js');
const { requireRole } = require('../middlewares/role.middleware.js');

const router = express.Router();

// Manual payments (Principal / Operator logic handled in controller)
router.post('/pay/manual', payManual);

// Online payments (Parent logic handled in controller)
router.post('/pay/online/initiate', checkOnlinePaymentAccess, initiateOnlinePayment);
router.post('/pay/online/verify', verifyOnlinePayment);
router.get(
  '/payments/student/me',
  requireRole('PARENT'),
  getMyPayments
);

router.get('/payments/student/:id', getPaymentsByStudent);

// Receipt download
router.get('/receipt/:receiptNo', getReceipt);

module.exports = router;
