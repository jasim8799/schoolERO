const express = require('express');

const { authenticate } = require('../middlewares/auth.middleware');
const ctrl = require('../controllers/reports.enterprise.controller');

const router = express.Router();

router.use(authenticate);

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
