const express = require('express');

const { authenticate } = require('../middlewares/auth.middleware');
const { createRateLimit } = require('../middlewares/rateLimit.middleware.fixed');
const ctrl = require('../controllers/reports.enterprise.controller');

const router = express.Router();
const apiBurstLimiter = createRateLimit(120, 15 * 60 * 1000, 'REPORTS_ENTERPRISE');

router.use(authenticate);
router.use(apiBurstLimiter);

router.get('/', ctrl.getReports);
router.get('/metrics', ctrl.getMetrics);
router.get('/analytics', ctrl.getAnalytics);
router.get('/insights', ctrl.getInsights);
router.get('/infrastructure', ctrl.getInfrastructure);
router.get('/export-monitor', ctrl.getExportMonitor);
router.get('/query-logs', ctrl.getQueryLogs);

router.post('/generate', ctrl.generateReport);
router.post('/schedule', ctrl.scheduleReport);
router.post('/export', ctrl.exportReport);
router.post('/retry', ctrl.retryReport);
router.post('/archive', ctrl.archiveReport);

router.get('/:id', ctrl.getReportById);

module.exports = router;
