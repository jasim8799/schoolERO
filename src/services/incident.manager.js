// services/incident.manager.js
// Comprehensive incident creation and management for SOC
// Handles SecurityIncident, IncidentFeedItem, TimelineEvent, RadarEvent, ThreatIntelligence

const mongoose = require('mongoose');
const SecurityIncident = require('../models/SecurityIncident');
const IncidentFeedItem = require('../models/IncidentFeedItem');
const TimelineEvent = require('../models/TimelineEvent');
const RadarEvent = require('../models/RadarEvent');
const ThreatIntelligence = require('../models/ThreatIntelligence');
const GeoAnomaly = require('../models/GeoAnomaly');
const redis = require('../config/redis');
const { logger } = require('../utils/logger');
const crypto = require('crypto');

// ──────────────────────────────────────────────────────────────────────────
// Create Comprehensive Incident
// ──────────────────────────────────────────────────────────────────────────

/**
 * Create a full incident with all related data
 * Returns SecurityIncident with all supporting records
 */
async function createIncident({
  incidentType,
  title,
  description,
  severity = 'MEDIUM',
  riskScore = 0.5,
  aiConfidence = 0.8,
  schoolId,
  userId,
  ipAddress,
  country,
  city,
  latitude,
  longitude,
  targetSystem = 'Platform',
  threatCategories = [],
  mitreTactics = [],
  detectionMethod = 'AI_DETECTION',
  correlationId = crypto.randomBytes(12).toString('hex'),
} = {}) {
  try {
    const now = new Date();
    const incidentId = `INC-${now.getFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const eventId = crypto.randomBytes(8).toString('hex');
    
    // ── 1. Create SecurityIncident ───────────────────────────────────────
    const incident = await SecurityIncident.create({
      incidentId,
      correlationId,
      title,
      description,
      incidentType,
      status: 'DETECTED',
      severity,
      riskScore,
      aiConfidence,
      schoolId: schoolId ? mongoose.Types.ObjectId(schoolId) : null,
      userId: userId ? mongoose.Types.ObjectId(userId) : null,
      sourceIpAddress: ipAddress,
      sourceCountry: country,
      sourceCity: city,
      targetSystem,
      threatCategories,
      mitreTactics,
      detectionMethod,
      aiAnalysis: _generateIncidentAnalysis(incidentType, severity, riskScore),
      detectedAt: now,
      firstSeenAt: now,
    }).catch(err => {
      logger.error('SecurityIncident creation failed:', err.message);
      return null;
    });

    if (!incident) return null;

    // ── 2. Create IncidentFeedItem ──────────────────────────────────────
    const feedItem = await IncidentFeedItem.create({
      feedItemId: eventId,
      correlationId,
      incidentId: incident._id,
      event: title,
      eventType: incidentType,
      severity,
      status: 'ACTIVE',
      schoolId: schoolId ? mongoose.Types.ObjectId(schoolId) : null,
      userId: userId ? mongoose.Types.ObjectId(userId) : null,
      ipAddress,
      country,
      city,
      category: incidentType.replace(/_/g, ' '),
      timestamp: now,
      aiConfidence,
      riskScore,
      threatDescription: description,
      response: _getAutoResponse(severity, riskScore),
      responseDetails: `Automatically ${_getAutoResponse(severity, riskScore).toLowerCase()} due to severity=${severity}`,
      source: 'incident.manager',
      icon: _getIconForType(incidentType),
    }).catch(err => {
      logger.error('IncidentFeedItem creation failed:', err.message);
      return null;
    });

    // ── 3. Create TimelineEvent (Detection phase) ───────────────────────
    const timelineEvent = await TimelineEvent.create({
      timelineEventId: crypto.randomBytes(8).toString('hex'),
      incidentId: incident._id,
      correlationId,
      phase: 'DETECTION',
      title: `${incidentType} Detected`,
      description: `Security system detected ${incidentType.toLowerCase()} event from ${ipAddress}`,
      details: description,
      severity,
      schoolId: schoolId ? mongoose.Types.ObjectId(schoolId) : null,
      userId: userId ? mongoose.Types.ObjectId(userId) : null,
      ipAddress,
      source: 'incident.manager',
      occurredAt: now,
      actionType: 'AUTOMATED',
      action: _getAutoResponse(severity, riskScore),
    }).catch(err => {
      logger.error('TimelineEvent creation failed:', err.message);
      return null;
    });

    // ── 4. Create RadarEvent (for live threat visualization) ────────────
    if (latitude && longitude) {
      const radarEvent = await RadarEvent.create({
        radarEventId: crypto.randomBytes(8).toString('hex'),
        correlationId,
        threatType: incidentType,
        ipAddress,
        latitude,
        longitude,
        country,
        city,
        severity,
        riskScore,
        schoolId: schoolId ? mongoose.Types.ObjectId(schoolId) : null,
        userId: userId ? mongoose.Types.ObjectId(userId) : null,
        sourceEventId: eventId,
        incidentId: incident._id,
        confidence: aiConfidence,
        analysisText: description,
        source: 'incident.manager',
        description: title,
        icon: _getIconForType(incidentType),
        status: 'ACTIVE',
        detectedAt: now,
        eventCount: 1,
      }).catch(err => {
        logger.error('RadarEvent creation failed:', err.message);
        return null;
      });
    }

    // ── 5. Create ThreatIntelligence record ──────────────────────────────
    const threatIntel = await ThreatIntelligence.create({
      threatIntelId: crypto.randomBytes(8).toString('hex'),
      correlationId,
      title: `${incidentType} Threat Analysis`,
      analysis: _generateThreatAnalysis(incidentType, severity, riskScore),
      threatDescription: description,
      severity,
      confidence: aiConfidence,
      impact: _mapSeverityToImpact(severity),
      schoolId: schoolId ? mongoose.Types.ObjectId(schoolId) : null,
      threatType: incidentType,
      mitreTactics,
      sourceEventIds: [eventId],
      sourceIncidentIds: [incident._id],
      recommendation: _generateRecommendation(incidentType, severity),
      recommendedActions: _generateRecommendedActions(incidentType, severity),
      remediationSteps: _generateRemediationSteps(incidentType),
      detectionMethod,
      affectedSystem: targetSystem,
      affectedCount: 1,
      riskScore,
      remediationStatus: 'PENDING',
      tags: _generateTags(incidentType, severity),
    }).catch(err => {
      logger.error('ThreatIntelligence creation failed:', err.message);
      return null;
    });

    // ── 6. Update incident with references ──────────────────────────────
    if (feedItem) {
      await SecurityIncident.findByIdAndUpdate(incident._id, {
        $set: {
          relatedEventIds: [feedItem.feedItemId],
        },
      }).catch(err => logger.error('Incident update failed:', err.message));
    }

    // ── 7. Update Redis metrics ─────────────────────────────────────────
    await _updateIncidentMetrics(incident, schoolId).catch(err => {
      logger.error('Redis metrics update failed:', err.message);
    });

    logger.info(`[INCIDENT] Created: ${incidentId} type=${incidentType} severity=${severity} risk=${riskScore}`);

    return {
      incident,
      feedItem,
      timelineEvent,
      threatIntel,
      incidentId: incident._id,
    };
  } catch (err) {
    logger.error('Incident creation failed:', err.message);
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Create Incident Feed Item (Fast ingestion)
// ──────────────────────────────────────────────────────────────────────────

async function createIncidentFeedItem({
  event,
  eventType,
  severity,
  ipAddress,
  country,
  city,
  schoolId,
  userId,
  description,
  riskScore = 0.5,
  aiConfidence = 0.8,
  source = 'security.event.logger',
} = {}) {
  try {
    const feedItemId = crypto.randomBytes(8).toString('hex');
    
    const feedItem = await IncidentFeedItem.create({
      feedItemId,
      event,
      eventType,
      severity,
      status: 'ACTIVE',
      schoolId: schoolId ? mongoose.Types.ObjectId(schoolId) : null,
      userId: userId ? mongoose.Types.ObjectId(userId) : null,
      ipAddress,
      country,
      city,
      category: eventType.replace(/_/g, ' '),
      timestamp: new Date(),
      aiConfidence,
      riskScore,
      threatDescription: description,
      response: _getAutoResponse(severity, riskScore),
      source,
      icon: _getIconForType(eventType),
    });

    return feedItem;
  } catch (err) {
    logger.error('IncidentFeedItem creation error:', err.message);
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Get Security Monitoring Data (for Enterprise Security Monitoring table)
// ──────────────────────────────────────────────────────────────────────────

async function getSecurityMonitoringData(schoolId, filters = {}) {
  try {
    const query = {
      isDeleted: false,
      createdAt: { $gte: new Date(Date.now() - 7 * 86400000) }, // Last 7 days
    };

    if (schoolId) {
      query.schoolId = mongoose.Types.ObjectId(schoolId);
    }

    if (filters.severity && filters.severity !== 'ALL') {
      query.severity = filters.severity;
    }

    if (filters.status) {
      query.status = filters.status;
    }

    const incidents = await SecurityIncident.find(query)
      .select(
        'incidentId incidentType severity status riskScore aiConfidence ' +
        'sourceIpAddress sourceCountry sourceCity targetSystem ' +
        'detectedAt firstSeenAt'
      )
      .sort({ detectedAt: -1 })
      .limit(100)
      .lean();

    return incidents.map(inc => ({
      id: inc._id,
      threat: inc.incidentType,
      threatId: inc.incidentId,
      source: 'Security System',
      severity: inc.severity,
      status: inc.status,
      risk: inc.riskScore,
      aiConf: inc.aiConfidence,
      location: `${inc.sourceCity}, ${inc.sourceCountry}`,
      target: inc.targetSystem,
      response: inc.status === 'RESOLVED' ? 'Mitigated' : 'Monitoring',
      timestamp: new Date(inc.detectedAt).toLocaleString(),
      ipAddress: inc.sourceIpAddress,
    }));
  } catch (err) {
    logger.error('getSecurityMonitoringData error:', err.message);
    return [];
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Get Incident Feed (Real data)
// ──────────────────────────────────────────────────────────────────────────

async function getIncidentFeed(schoolId, limit = 50) {
  try {
    const query = { isDeleted: false };
    if (schoolId) query.schoolId = mongoose.Types.ObjectId(schoolId);

    const items = await IncidentFeedItem.find(query)
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    return items.map(item => ({
      event: item.event,
      severity: item.severity,
      timestamp: item.timestamp,
      sourceIp: item.ipAddress,
      country: item.country,
      category: item.category,
      aiConfidence: `AI:${(item.aiConfidence * 100).toFixed(0)}%`,
      response: item.response,
      icon: item.icon,
    }));
  } catch (err) {
    logger.error('getIncidentFeed error:', err.message);
    return [];
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Get Timeline Data
// ──────────────────────────────────────────────────────────────────────────

async function getTimelineData(incidentId) {
  try {
    const query = { isDeleted: false };
    if (incidentId) query.incidentId = mongoose.Types.ObjectId(incidentId);

    const events = await TimelineEvent.find(query)
      .sort({ occurredAt: 1 })
      .lean();

    return events.map(evt => ({
      title: evt.title,
      severity: evt.severity,
      timestamp: new Date(evt.occurredAt).toLocaleString(),
      details: evt.description,
      phase: evt.phase,
    }));
  } catch (err) {
    logger.error('getTimelineData error:', err.message);
    return [];
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Get Radar Data (Real threats only)
// ──────────────────────────────────────────────────────────────────────────

async function getRadarData(schoolId) {
  try {
    const query = {
      isDeleted: false,
      status: { $in: ['ACTIVE', 'INVESTIGATING'] },
      detectedAt: { $gte: new Date(Date.now() - 86400000) }, // Last 24 hours
    };

    if (schoolId) query.schoolId = mongoose.Types.ObjectId(schoolId);

    const radarPoints = await RadarEvent.find(query)
      .select('latitude longitude ipAddress threatType severity riskScore')
      .lean();

    const threats = await RadarEvent.find(query)
      .select('threatType level riskScore')
      .lean();

    return {
      points: radarPoints.map(p => ({
        lat: p.latitude,
        lon: p.longitude,
        ip: p.ipAddress,
        severity: p.severity,
        type: p.threatType,
      })),
      threats: _aggregateThreats(threats),
    };
  } catch (err) {
    logger.error('getRadarData error:', err.message);
    return { points: [], threats: [] };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Get Threat Intelligence
// ──────────────────────────────────────────────────────────────────────────

async function getThreatIntelligence(schoolId, limit = 10) {
  try {
    const query = { isDeleted: false };
    if (schoolId) query.schoolId = mongoose.Types.ObjectId(schoolId);

    const intel = await ThreatIntelligence.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return intel.map(item => ({
      title: item.title,
      analysis: item.analysis,
      severity: item.severity,
      confidence: `${(item.confidence * 100).toFixed(0)}%`,
      impact: item.impact,
      recommendation: item.recommendation,
      threatType: item.threatType,
    }));
  } catch (err) {
    logger.error('getThreatIntelligence error:', err.message);
    return [];
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Get Geo Anomalies
// ──────────────────────────────────────────────────────────────────────────

async function getGeoAnomalies(schoolId, limit = 10) {
  try {
    const query = {
      isDeleted: false,
      status: { $in: ['DETECTED', 'INVESTIGATING'] },
    };
    if (schoolId) query.schoolId = mongoose.Types.ObjectId(schoolId);

    const anomalies = await GeoAnomaly.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return anomalies.map(anom => ({
      country: anom.country,
      city: anom.city,
      ip: anom.ipAddress,
      event: anom.anomalyType,
      risk: anom.riskScore,
      vpn: anom.vpn,
    }));
  } catch (err) {
    logger.error('getGeoAnomalies error:', err.message);
    return [];
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Helper Functions
// ──────────────────────────────────────────────────────────────────────────

function _generateIncidentAnalysis(incidentType, severity, riskScore) {
  const analyses = {
    FAILED_LOGIN: `Failed authentication attempt detected. ${severity === 'CRITICAL' ? 'Multiple failed attempts may indicate brute force attack.' : 'Monitoring for patterns.'}`,
    BRUTE_FORCE: 'Multiple failed login attempts from same IP detected. This pattern indicates a brute force attack.',
    GEO_ANOMALY: 'Geographic anomaly detected - user location changed unexpectedly.',
    FIREWALL_BLOCK: 'Network request blocked by firewall rules.',
    INJECTION_ATTEMPT: 'Potential injection attack detected.',
    SESSION_HIJACK: 'Unusual session activity detected.',
    PRIVILEGE_ESCALATION: 'Unauthorized privilege escalation attempt.',
    API_ABUSE: 'API rate limit exceeded or unusual API usage pattern.',
    ADMIN_ABUSE: 'Unusual administrative action detected.',
    MALWARE_DETECTION: 'Malware signature or suspicious file detected.',
    CREDENTIAL_STUFFING: 'Credential stuffing attack pattern detected.',
    ACCOUNT_LOCK: 'User account has been locked due to security policy.',
    SUSPICIOUS_IP: 'Suspicious IP address accessing platform.',
    DATA_EXFILTRATION: 'Potential data exfiltration detected.',
    DDoS_ATTACK: 'Distributed Denial of Service attack detected.',
  };

  return analyses[incidentType] || `Security incident of type ${incidentType} detected.`;
}

function _getAutoResponse(severity, riskScore) {
  if (severity === 'CRITICAL' || riskScore > 0.8) return 'BLOCK_IP';
  if (severity === 'HIGH' || riskScore > 0.6) return 'REQUIRE_MFA';
  if (severity === 'MEDIUM' || riskScore > 0.4) return 'WARN_USER';
  return 'LOG_ONLY';
}

function _getIconForType(incidentType) {
  const iconMap = {
    FAILED_LOGIN: 'lock_person',
    BRUTE_FORCE: 'gpp_bad',
    ACCOUNT_LOCK: 'lock_outline',
    SUSPICIOUS_IP: 'gps_not_fixed',
    SESSION_HIJACK: 'security',
    GEO_ANOMALY: 'public',
    FIREWALL_BLOCK: 'shield',
    INJECTION_ATTEMPT: 'code',
    PRIVILEGE_ESCALATION: 'admin_panel_settings',
    ADMIN_ABUSE: 'manage_accounts',
    API_ABUSE: 'api',
    MALWARE_DETECTION: 'bug_report',
    CREDENTIAL_STUFFING: 'vpn_key_off',
    DATA_EXFILTRATION: 'storage',
    DDoS_ATTACK: 'dns',
  };
  return iconMap[incidentType] || 'security';
}

function _generateThreatAnalysis(incidentType, severity, riskScore) {
  return `Analysis of ${incidentType} incident with ${severity} severity and ${(riskScore * 100).toFixed(0)}% risk score. ` +
         `This threat requires immediate attention and remediation to prevent further damage.`;
}

function _mapSeverityToImpact(severity) {
  const map = {
    CRITICAL: 'CRITICAL',
    HIGH: 'HIGH',
    MEDIUM: 'MEDIUM',
    LOW: 'LOW',
  };
  return map[severity] || 'MEDIUM';
}

function _generateRecommendation(incidentType, severity) {
  const recommendations = {
    FAILED_LOGIN: 'Implement rate limiting and CAPTCHA challenges for repeated failed logins.',
    BRUTE_FORCE: 'Block the IP address and enforce multi-factor authentication.',
    GEO_ANOMALY: 'Require additional verification from new geographic location.',
    FIREWALL_BLOCK: 'Review firewall rules and investigate the source IP.',
    SESSION_HIJACK: 'Force user logout and revoke existing sessions.',
    PRIVILEGE_ESCALATION: 'Audit user permissions and disable unauthorized access.',
    API_ABUSE: 'Implement stricter API rate limiting and monitoring.',
    ADMIN_ABUSE: 'Review admin actions and restrict high-risk operations.',
  };
  return recommendations[incidentType] || 'Investigate and remediate according to security policy.';
}

function _generateRecommendedActions(incidentType, severity) {
  const actions = [];
  
  if (severity === 'CRITICAL') {
    actions.push('Immediately block the source IP');
    actions.push('Escalate to security team');
  }
  
  actions.push('Review logs for related activity');
  actions.push('Monitor for further incidents');
  
  if (incidentType === 'BRUTE_FORCE' || incidentType === 'FAILED_LOGIN') {
    actions.push('Reset user password');
    actions.push('Enable MFA');
  }
  
  return actions;
}

function _generateRemediationSteps(incidentType) {
  const steps = [
    'Verify incident details and confirm severity',
    'Contain the threat to prevent spread',
    'Eradicate the cause of the incident',
    'Restore systems to normal operation',
    'Monitor for recurrence',
  ];
  return steps;
}

function _generateTags(incidentType, severity) {
  const tags = [incidentType, severity.toLowerCase()];
  if (severity === 'CRITICAL') tags.push('urgent');
  if (incidentType.includes('BRUTE')) tags.push('brute_force');
  if (incidentType.includes('LOGIN')) tags.push('authentication');
  return tags;
}

async function _updateIncidentMetrics(incident, schoolId) {
  const redis = require('../config/redis');
  const key = `security:incidents:${schoolId || 'global'}:24h`;
  await redis.incr(key).catch(() => {});
  await redis.expire(key, 86400).catch(() => {});
}

function _aggregateThreats(threats) {
  const aggregated = {};
  threats.forEach(t => {
    const type = t.threatType || 'UNKNOWN';
    if (!aggregated[type]) {
      aggregated[type] = {
        name: type,
        level: t.riskScore || 0.5,
        count: 0,
      };
    }
    aggregated[type].count += 1;
    aggregated[type].level = Math.max(aggregated[type].level, t.riskScore || 0.5);
  });
  return Object.values(aggregated);
}

// ──────────────────────────────────────────────────────────────────────────
// Exports
// ──────────────────────────────────────────────────────────────────────────

module.exports = {
  createIncident,
  createIncidentFeedItem,
  getSecurityMonitoringData,
  getIncidentFeed,
  getTimelineData,
  getRadarData,
  getThreatIntelligence,
  getGeoAnomalies,
};
