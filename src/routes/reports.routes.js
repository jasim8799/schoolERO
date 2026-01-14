const express = require('express');
const { getStudentList, getExamResults, getStudentHistory, getStudentAttendance, getTeacherAttendance, getFeeReports, getPaymentReports, getExpenseReport, getSalaryReport, getProfitLossReport, getPromotionReport, getRetentionReport, getTCReport, getHistoryReport } = require('../controllers/reports.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { validateSchool } = require('../middlewares/school.middleware');

const router = express.Router();

// All routes require authentication and school validation
router.use(authenticate);
router.use(validateSchool);

// Student list report - Principal/Operator/Teacher only
router.get('/students', getStudentList);

// Exam results report - Principal/Operator/Teacher only
router.get('/results', getExamResults);

// Student academic history report - Principal/Operator/Teacher only
router.get('/student-history/:studentId', getStudentHistory);

// Student attendance report - Principal/Operator/Teacher only
router.get('/attendance/students', getStudentAttendance);

// Teacher attendance report - Principal/Operator/Teacher only
router.get('/attendance/teachers', getTeacherAttendance);

// Fee reports - Principal/Operator only
router.get('/fees', getFeeReports);

// Payment reports - Principal/Operator only
router.get('/payments', getPaymentReports);

// Expense report - Principal/Operator only
router.get('/expenses', getExpenseReport);

// Salary report - Principal/Operator only
router.get('/salary', getSalaryReport);

// Profit/Loss report - Principal/Operator only
router.get('/profit-loss', getProfitLossReport);

// Promotion report - Principal/Operator only
router.get('/promotion', getPromotionReport);

// Retention report - Principal/Operator only
router.get('/retention', getRetentionReport);

// TC report - Principal/Operator only
router.get('/tc', getTCReport);

// Academic history report - Principal/Operator only
router.get('/history', getHistoryReport);

module.exports = router;
