const express = require('express');
const {
  getStudentBills,
  getSchoolBills,
  createBill,
  payBill,
  getBillSummary,
  getLedger,
  getProfitLoss,
  getBillReceipt,
  getBillHtmlReceipt,
} = require('../controllers/bill.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/role.middleware');
const { checkSchoolStatus } = require('../middlewares/school.middleware.js');
const Bill = require('../models/Bill');
const Student = require('../models/Student');
const Parent = require('../models/Parent');

// Token-from-query middleware (for iframe receipt requests that cannot send headers)
const injectTokenFromQuery = (req, res, next) => {
  if (!req.headers.authorization && req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
};

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
  '/student/me',
  requireRole('STUDENT', 'PARENT'),
  async (req, res) => {
    try {
      const { schoolId, _id: userId, role, sessionId } = req.user;
      const { childId } = req.query;

      let studentId;
      if (role === 'STUDENT') {
        const student = await Student.findOne({ userId, schoolId }).select('_id');
        if (!student) return res.json({ success: true, data: [] });
        studentId = student._id;
      } else if (role === 'PARENT') {
        const parent = await Parent.findOne({ userId, schoolId }).populate('children', '_id');
        const children = parent?.children || [];
        if (!children.length) return res.json({ success: true, data: [] });

        const selectedChildId = childId || children[0]?._id?.toString();
        const hasAccess = children.some((c) => c?._id?.toString() === selectedChildId);
        if (!hasAccess) {
          return res.status(403).json({ success: false, message: 'Forbidden' });
        }
        studentId = selectedChildId;
      }

      const sFilter = sessionId
        ? { $or: [{ sessionId }, { sessionId: { $exists: false } }] }
        : {};

      const filter = {
        studentId,
        schoolId,
        ...sFilter,
        ...(req.query.status ? { status: req.query.status } : {}),
      };

      const bills = await Bill.find(filter)
        .populate('sessionId', 'name')
        .sort({ createdAt: -1 })
        .lean();

      res.json({ success: true, data: bills });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

router.get(
  '/student/:studentId',
  requireRole('PRINCIPAL', 'OPERATOR', 'TEACHER', 'STUDENT', 'PARENT'),
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
  requireRole('PRINCIPAL', 'OPERATOR', 'PARENT'),
  payBill
);

// Bill receipt PDF (by receipt number)
router.get(
  '/receipt/:receiptNumber',
  getBillReceipt
);

// Bill receipt HTML page (by bill _id) — print-ready, auto-opens in browser
router.get(
  '/:id/receipt',
  injectTokenFromQuery,
  requireRole('PRINCIPAL', 'OPERATOR', 'PARENT', 'STUDENT'),
  getBillHtmlReceipt
);

module.exports = router;
