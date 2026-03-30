const express = require('express');
const {
  payManual,
  getPaymentsByStudent,
  initiateOnlinePayment,
  verifyOnlinePayment,
  getMyPayments,
  getReceipt
} = require('../controllers/feePayment.controller.js');
const { assignFee } = require('../controllers/studentFee.controller.js');

const { checkOnlinePaymentAccess } = require('../middlewares/onlinePayment.middleware.js');
const { requireRole } = require('../middlewares/role.middleware.js');

const router = express.Router();

// Assign a fee structure to an individual student
router.post('/assign', requireRole('PRINCIPAL', 'OPERATOR'), assignFee);

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
