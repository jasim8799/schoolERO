const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth.middleware');
const {
	getAuditLogsController,
	getAuditStatsController,
	getInfrastructureController,
	getThreatsController,
	exportLogsController,
} = require('../controllers/audit.controller');

router.use(authenticate);

router.get('/',               getAuditLogsController);
router.get('/logs',           getAuditLogsController);
router.get('/stats',          getAuditStatsController);
router.get('/infrastructure', getInfrastructureController);
router.get('/threats',        getThreatsController);

router.post('/export',        exportLogsController);

module.exports = router;
