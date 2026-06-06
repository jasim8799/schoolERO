const { getLiveMetrics } = require('../services/security.metrics');
const { getIncidentFeed, getRadarData, getGeoAnomalies, getThreatIntelligence } = require('../services/incident.manager');

function initSecuritySocket(io) {
  const nsp = io.of('/security');

  nsp.on('connection', async (socket) => {
    // Subscribe to real-time security updates
    socket.on('security:subscribe', () => {
      socket.join('security:global');
      
      // Send initial data
      try {
        Promise.all([
          getLiveMetrics(),
          getIncidentFeed(null, 20),
          getRadarData(null),
          getGeoAnomalies(null, 10),
          getThreatIntelligence(null, 5),
        ]).then(([metrics, feed, radar, geos, intel]) => {
          socket.emit('security:initial_data', {
            metrics,
            incidentFeed: feed,
            radarData: radar,
            geoAnomalies: geos,
            threatIntelligence: intel,
            timestamp: new Date(),
          });
        }).catch(() => {});
      } catch (_) {}
    });

    // Unsubscribe
    socket.on('security:unsubscribe', () => {
      socket.leave('security:global');
    });
  });

  return nsp;
}

/**
 * Broadcast metrics update to all connected clients
 */
function broadcastSecurityMetrics(metrics) {
  if (!global.io) return;
  global.io.of('/security').to('security:global').emit('security:metrics', metrics);
  global.io.emit('security:metrics_update', { metrics, threatLevel: metrics?.threatLevel || 'LOW' });
}

/**
 * Broadcast new incident to all connected clients
 */
function broadcastIncidentCreated(incident) {
  if (!global.io) return;
  global.io.of('/security').to('security:global').emit('security:incident_created', {
    incidentId: incident._id,
    incidentType: incident.incidentType,
    severity: incident.severity,
    riskScore: incident.riskScore,
    title: incident.title,
    timestamp: new Date(),
  });
}

/**
 * Broadcast incident feed item update
 */
function broadcastIncidentFeedItem(feedItem) {
  if (!global.io) return;
  global.io.of('/security').to('security:global').emit('security:feed_update', {
    feedItemId: feedItem.feedItemId,
    event: feedItem.event,
    severity: feedItem.severity,
    timestamp: feedItem.timestamp,
    ipAddress: feedItem.ipAddress,
    category: feedItem.category,
    response: feedItem.response,
  });
}

/**
 * Broadcast threat detection
 */
function broadcastThreatDetected(threat) {
  if (!global.io) return;
  global.io.of('/security').to('security:global').emit('security:threat_created', {
    threatId: threat.radarEventId,
    threatType: threat.threatType,
    severity: threat.severity,
    riskScore: threat.riskScore,
    ipAddress: threat.ipAddress,
    country: threat.country,
    city: threat.city,
    latitude: threat.latitude,
    longitude: threat.longitude,
    timestamp: new Date(),
  });
}

/**
 * Broadcast radar update (new threat point)
 */
function broadcastRadarUpdate(radarEvent) {
  if (!global.io) return;
  global.io.of('/security').to('security:global').emit('security:radar_update', {
    event: radarEvent,
    timestamp: new Date(),
  });
}

/**
 * Broadcast geo anomaly detection
 */
function broadcastGeoAnomaly(anomaly) {
  if (!global.io) return;
  global.io.of('/security').to('security:global').emit('security:geo_update', {
    anomalyId: anomaly.anomalyId,
    country: anomaly.country,
    city: anomaly.city,
    ipAddress: anomaly.ipAddress,
    anomalyType: anomaly.anomalyType,
    severity: anomaly.severity,
    riskScore: anomaly.riskScore,
    timestamp: new Date(),
  });
}

/**
 * Broadcast AI threat analysis
 */
function broadcastAIAnalysis(analysis) {
  if (!global.io) return;
  global.io.of('/security').to('security:global').emit('security:ai_update', {
    threatIntelId: analysis.threatIntelId,
    threatType: analysis.threatType,
    confidence: analysis.confidence,
    severity: analysis.severity,
    title: analysis.title,
    analysis: analysis.analysis,
    timestamp: new Date(),
  });
}

/**
 * Broadcast failed login attempt
 */
function broadcastFailedLogin(data) {
  if (!global.io) return;
  global.io.of('/security').to('security:global').emit('security:failed_login', {
    ipAddress: data.ipAddress,
    email: data.email,
    severity: data.severity,
    timestamp: new Date(),
  });
}

/**
 * Broadcast brute force detection
 */
function broadcastBruteForce(data) {
  if (!global.io) return;
  global.io.of('/security').to('security:global').emit('security:brute_force_detected', {
    ipAddress: data.ipAddress,
    email: data.email,
    attempts: data.attempts,
    severity: data.severity,
    timestamp: new Date(),
  });
}

/**
 * Broadcast account lock event
 */
function broadcastAccountLocked(data) {
  if (!global.io) return;
  global.io.of('/security').to('security:global').emit('security:account_locked', {
    userId: data.userId,
    email: data.email,
    lockoutLevel: data.lockoutLevel,
    lockedUntil: data.lockedUntil,
    timestamp: new Date(),
  });
}

module.exports = {
  initSecuritySocket,
  broadcastSecurityMetrics,
  broadcastIncidentCreated,
  broadcastIncidentFeedItem,
  broadcastThreatDetected,
  broadcastRadarUpdate,
  broadcastGeoAnomaly,
  broadcastAIAnalysis,
  broadcastFailedLogin,
  broadcastBruteForce,
  broadcastAccountLocked,
};
