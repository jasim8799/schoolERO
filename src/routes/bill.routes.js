const express = require('express');
const {
  getStudentBills,
  getSchoolBills,
  createBill,
  payBill,
  getBillSummary,
  getLedger,
  getProfitLoss,
  getBillReceipt
} = require('../controllers/bill.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/role.middleware');
const { checkSchoolStatus } = require('../middlewares/school.middleware.js');

const router = express.Router();
router.use(authenticate);
router.use(checkSchoolStatus);

// Summary — for dashboard
router.get(
  '/summary',
  requireRole('PRINCIPAL', 'OPERATOR'),
  getBillSummary
);

// Ledger entries
router.get(
  '/ledger',
  requireRole('PRINCIPAL', 'OPERATOR'),
  getLedger
);

// Profit & Loss report
router.get(
  '/profit-loss',
  requireRole('PRINCIPAL', 'OPERATOR'),
  getProfitLoss
);

// All school bills — for fee dashboard
router.get(
  '/',
  requireRole('PRINCIPAL', 'OPERATOR'),
  getSchoolBills
);

// Student bills — for student/parent view and fee assignment
router.get(
  '/student/:studentId',
  requireRole('PRINCIPAL', 'OPERATOR', 'STUDENT', 'PARENT'),
  getStudentBills
);

// Create bill manually
router.post(
  '/',
  requireRole('PRINCIPAL', 'OPERATOR'),
  createBill
);

// Pay a bill
router.post(
  '/:billId/pay',
  requireRole('PRINCIPAL', 'OPERATOR'),
  payBill
);

// Bill receipt PDF
router.get(
  '/receipt/:receiptNumber',
  getBillReceipt
);

module.exports = router;
