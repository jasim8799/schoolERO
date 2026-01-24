const express = require('express');
const { getProfitLossReport, getPromotionReport, getRetentionReport, getTCReport, getHistoryReport } = require('../controllers/reports.controller');
const { getDashboardSummary, getStudentStrengthReport, getDailyAttendanceReport, getMonthlyAttendanceReport, getFeesSummaryReport, getFeesMonthlyReport, getFeesPendingReport, getExamsSummaryReport, getExamTopperReport, getSalaryMonthlyReport, getStaffSalaryReport, getTransportReport, getHostelReport } = require('../controllers/reports.analytics.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { checkSchoolStatus } = require('../middlewares/school.middleware');

const router = express.Router();

// All routes require authentication and school validation
router.use(authenticate);
router.use(checkSchoolStatus);

// Analytics Reports - Principal/Operator only
router.get('/dashboard', getDashboardSummary);
router.get('/students', getStudentStrengthReport);
router.get('/attendance/daily', getDailyAttendanceReport);
router.get('/attendance/monthly', getMonthlyAttendanceReport);
router.get('/fees/summary', getFeesSummaryReport);
router.get('/fees/monthly', getFeesMonthlyReport);
router.get('/fees/pending', getFeesPendingReport);
router.get('/exams/summary', getExamsSummaryReport);
router.get('/exams/topper', getExamTopperReport);
router.get('/salary/monthly', getSalaryMonthlyReport);
router.get('/salary/staff/:id', getStaffSalaryReport);
router.get('/transport', getTransportReport);
router.get('/hostel', getHostelReport);

// Existing Reports - Principal/Operator only
router.get('/profit-loss', getProfitLossReport);
router.get('/promotion', getPromotionReport);
router.get('/retention', getRetentionReport);
router.get('/tc', getTCReport);
router.get('/history', getHistoryReport);

module.exports = router;
