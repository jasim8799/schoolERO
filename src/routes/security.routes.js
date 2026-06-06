const express = require('express');
const {
  getSecurityData,
  getSecurityEventById,
  blockThreat,
  getRadarData,
  getSecurityMetrics,
  // PHASE 3 & 4 - Monitoring & Incidents
  getMonitoringTable,
  getIncidents,
  getIncidentById,
  // PHASE 4 - Incident Feed
  getIncidentFeedData,
  // PHASE 5 - Timeline
  getTimelineData,
  // PHASE 6 - Radar
  getLiveRadarData,
  // PHASE 7 & 8 - Threat Intelligence
  getThreatIntelData,
  // PHASE 9 - Geo Anomalies
  getGeoAnomaliesData,
} = require('../controllers/security.controller');
const { requireRole } = require('../middlewares/role.middleware');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();
router.use(requireRole(USER_ROLES.SUPER_ADMIN));

// ────────────────────────────────────────────────────────────────────────
// ORIGINAL ENDPOINTS
// ────────────────────────────────────────────────────────────────────────

// GET /api/security           — full security dashboard
// Params: severity, search, limit
router.get('/', getSecurityData);

// GET /api/security/metrics   — fast metrics-only refresh endpoint
router.get('/metrics', getSecurityMetrics);

// GET /api/security/radar     — radar summary for the layout
router.get('/radar', getRadarData);

// POST /api/security/block    — block a threat (logs admin action)
// Must be before /:id to avoid route conflict
router.post('/block', blockThreat);

// GET /api/security/:id       — single threat event detail
router.get('/:id', getSecurityEventById);

// ────────────────────────────────────────────────────────────────────────
// PHASE 3 - ENTERPRISE SECURITY MONITORING
// ────────────────────────────────────────────────────────────────────────

// GET /api/security/monitoring — Enterprise security monitoring table (real data)
// Params: severity, status, limit
router.get('/monitoring', getMonitoringTable);

// GET /api/security/incidents  — List all security incidents
// Params: severity, status, limit
router.get('/incidents', getIncidents);

// GET /api/security/incidents/:id — Get single incident with all details
router.get('/incidents/:id', getIncidentById);

// ────────────────────────────────────────────────────────────────────────
// PHASE 4 - REALTIME INCIDENT FEED
// ────────────────────────────────────────────────────────────────────────

// GET /api/security/incident-feed — Real-time incident feed
// Params: limit, status
router.get('/incident-feed', getIncidentFeedData);

// ────────────────────────────────────────────────────────────────────────
// PHASE 5 - INCIDENT TIMELINE
// ────────────────────────────────────────────────────────────────────────

// GET /api/security/timeline — Incident timeline events
// Params: incidentId, limit
router.get('/timeline', getTimelineData);

// ────────────────────────────────────────────────────────────────────────
// PHASE 6 - LIVE THREAT RADAR
// ────────────────────────────────────────────────────────────────────────

// GET /api/security/live-radar — Real threat radar with geo points
// Returns: { points: [...], threats: [...] }
router.get('/live-radar', getLiveRadarData);

// ────────────────────────────────────────────────────────────────────────
// PHASE 7 & 8 - THREAT INTELLIGENCE
// ────────────────────────────────────────────────────────────────────────

// GET /api/security/threat-intel — Threat intelligence analysis
// Params: limit, threatType
router.get('/threat-intel', getThreatIntelData);

// ────────────────────────────────────────────────────────────────────────
// PHASE 9 - GEO ANOMALY TRACKING
// ────────────────────────────────────────────────────────────────────────

// GET /api/security/geo-anomalies — Geo anomaly detection
// Params: limit, status
router.get('/geo-anomalies', getGeoAnomaliesData);

module.exports = router;
