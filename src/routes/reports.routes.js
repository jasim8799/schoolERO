const express = require('express');
const { getProfitLossReport, getPromotionReport, getRetentionReport, getTCReport, getHistoryReport } = require('../controllers/reports.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { checkSchoolStatus } = require('../middlewares/school.middleware');

const router = express.Router();

// All routes require authentication and school validation
router.use(authenticate);
router.use(checkSchoolStatus);

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
