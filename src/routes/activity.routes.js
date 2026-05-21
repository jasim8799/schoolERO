const express = require('express');
const router  = express.Router();
const { requireRole }   = require('../middlewares/role.middleware');
const { USER_ROLES }    = require('../config/constants');
const ctrl = require('../controllers/activity.controller');

router.use(requireRole(USER_ROLES.SUPER_ADMIN));

// ── Feed ─────────────────────────────────────────────────────────────────────
router.get('/',    ctrl.getActivityFeed);   // Main feed + metrics + threats + timeline
router.get('/:id', ctrl.getActivityById);   // Detail with AI analysis + all tabs

// ── Actions ──────────────────────────────────────────────────────────────────
router.post('/block',              ctrl.blockIpAddress);       // Block an IP address
router.post('/diagnostics/run',    ctrl.runSystemDiagnostics); // Infrastructure diagnostics
router.patch('/:id/status',        ctrl.updateEventStatus);    // Update event status

module.exports = router;
