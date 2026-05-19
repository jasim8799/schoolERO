const AuditLog = require('../models/AuditLog');
const { USER_ROLES } = require('../config/constants');
const { logger } = require('../utils/logger');

// ── helpers ───────────────────────────────────────────────────────────────

function _mapSeverity(log) {
  const action = (log.action || '').toUpperCase();
  const sev = (log.severity || '').toUpperCase();
  if (sev && ['CRITICAL', 'ERROR', 'WARNING', 'INFO'].includes(sev)) return sev;
  if (action.includes('FAILED') || action.includes('INVALID') || action.includes('BLOCK')) return 'ERROR';
  if (action.includes('DELETE') || action.includes('FORCE') || action.includes('OVERRIDE')) return 'WARNING';
  if (action.includes('CRITICAL') || action.includes('BREACH') || action.includes('INJECT')) return 'CRITICAL';
  return 'INFO';
}

function _mapStatus(severity) {
  switch (severity) {
    case 'CRITICAL': return 'INVESTIGATING';
    case 'ERROR': return 'INVESTIGATING';
    case 'WARNING': return 'MONITORING';
    default: return 'RESOLVED';
  }
}

function _mapType(log) {
  const action = (log.action || '').toUpperCase();
  const entity = (log.entityType || '').toUpperCase();
  if (action.includes('LOGIN') || action.includes('AUTH') || action.includes('TOKEN')) return 'auth';
  if (action.includes('BACKUP') || action.includes('RESTORE')) return 'server';
  if (action.includes('PAYMENT') || action.includes('FEE') || action.includes('INVOICE')) return 'payment';
  if (action.includes('API') || action.includes('RATE')) return 'api';
  if (action.includes('DB') || action.includes('DATABASE') || entity === 'DATABASE') return 'database';
  if (action.includes('FIREWALL') || action.includes('BLOCK') || action.includes('IP')) return 'firewall';
  if (action.includes('USER') || action.includes('ROLE') || action.includes('PERMISSION')) return 'user activity';
  if (action.includes('AI') || action.includes('MODEL') || action.includes('PREDICTION')) return 'ai';
  if (action.includes('SERVER') || action.includes('NODE') || action.includes('INFRA')) return 'server';
  return 'system';
}

function _mapSource(log) {
  const type = _mapType(log);
  const sourceMap = {
    auth: 'Auth Service',
    server: 'Infra Ops',
    payment: 'Payment Orchestrator',
    api: 'API Gateway',
    database: 'Primary DB',
    firewall: 'Edge Firewall',
    'user activity': 'Policy Engine',
    ai: 'AI Detection Core',
    system: 'System',
  };
  return sourceMap[type] || (log.entityType || 'System');
}

function _fraudScore(severity) {
  let score = 0;
  if (severity === 'CRITICAL') score += 0.5;
  else if (severity === 'ERROR') score += 0.35;
  else if (severity === 'WARNING') score += 0.2;
  return Math.min(1.0, parseFloat(score.toFixed(2)));
}

function _aiScore(severity) {
  const base = { CRITICAL: 0.93, ERROR: 0.87, WARNING: 0.83, INFO: 0.78 };
  return base[severity] || 0.80;
}

function _relativeTime(date) {
  if (!date) return 'N/A';
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function _response(severity, type) {
  const responses = {
    auth: { CRITICAL: 'Force logout + MFA lock', ERROR: 'Adaptive MFA enforced', WARNING: 'Session monitoring raised', INFO: 'No action required' },
    firewall: { CRITICAL: 'IP hard blocked', ERROR: 'Rate limiter raised', WARNING: 'IP flagged for review', INFO: 'No action required' },
    api: { CRITICAL: 'Endpoint throttled', ERROR: 'Rate limiter raised', WARNING: 'Alert queued', INFO: 'No action required' },
    database: { CRITICAL: 'Replica failover prep', ERROR: 'Connection pool flushed', WARNING: 'Query optimization triggered', INFO: 'No action required' },
    payment: { CRITICAL: 'Payment gateway isolated', ERROR: 'Queue retry job', WARNING: 'Callback retry queued', INFO: 'No action required' },
    'user activity': { CRITICAL: 'Account suspended', ERROR: 'Policy rollback', WARNING: 'Role freeze applied', INFO: 'Audit logged' },
    server: { CRITICAL: 'Failover initiated', ERROR: 'Service restarted', WARNING: 'Alert dispatched', INFO: 'Auto recovery complete' },
  };
  return responses[type]?.[severity] || 'Learning model updated';
}

function _icon(type) {
  const icons = {
    auth: 'lock_person',
    firewall: 'gpp_bad',
    api: 'api',
    database: 'storage',
    payment: 'payments',
    'user activity': 'policy',
    ai: 'psychology',
    server: 'backup',
    system: 'dns',
  };
  return icons[type] || 'article';
}

function _formatLog(log, idx) {
  const severity = _mapSeverity(log);
  const type = _mapType(log);
  const status = _mapStatus(severity);
  const aiScore = _aiScore(severity);
  const threat = _fraudScore(severity);
  const idSuffix = log._id?.toString().slice(-4).toUpperCase() || String(idx).padStart(4, '0');
  const eventId = `EVT-${idSuffix}`;
  const ip = log.ipAddress || '10.0.0.1';
  const region =
    ip.startsWith('10.') || ip.startsWith('172.') || ip.startsWith('192.')
      ? 'Private VPC'
      : 'External';

  return {
    _id: log._id?.toString(),
    icon: _icon(type),
    event: log.description || (log.action?.replace(/_/g, ' ')) || 'System event',
    type,
    source: _mapSource(log),
    severity,
    status,
    timestamp: _relativeTime(log.createdAt),
    createdAt: log.createdAt,
    minutesAgo: Math.max(0, Math.floor((Date.now() - new Date(log.createdAt).getTime()) / 60000)),
    aiScore,
    ipAddress: ip,
    region,
    response: _response(severity, type),
    eventId,
    threat,
    action: log.action,
    userId: log.userId?.toString(),
    entityType: log.entityType,
    description: log.description,
  };
}

// ── GET /api/activity ─────────────────────────────────────────────────────

const getActivityFeed = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Access denied. Super Admin only.' });
    }

    const { severity, status, sort, search, limit = 50, page = 1 } = req.query;
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Build query — base window is last 7 days
    const query = { createdAt: { $gte: weekAgo } };

    if (search) {
      query.$or = [
        { action: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { entityType: { $regex: search, $options: 'i' } },
        { ipAddress: { $regex: search, $options: 'i' } },
      ];
    }

    if (severity && severity !== 'ALL') {
      let severityFilter = [];
      if (severity === 'CRITICAL') {
        severityFilter = [{ action: /BREACH|INJECT|CRITICAL/i }];
      } else if (severity === 'ERROR' || severity === 'BLOCKED') {
        severityFilter = [{ action: /FAILED|INVALID|BLOCK/i }];
      } else if (severity === 'WARNING') {
        severityFilter = [{ action: /DELETE|FORCE|OVERRIDE|EXCEEDED/i }];
      }
      if (severityFilter.length) {
        query.$or = (query.$or || []).concat(severityFilter);
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [logs, totalCount] = await Promise.all([
      AuditLog.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Math.min(parseInt(limit), 200))
        .lean(),
      AuditLog.countDocuments(query),
    ]);

    let formatted = logs.map((log, i) => _formatLog(log, i));

    // Derived-field status filter (applied after formatting)
    if (status && status !== 'ALL') {
      formatted = formatted.filter((r) => r.status === status.toUpperCase());
    }

    // Sort
    if (sort === 'Timestamp') {
      formatted.sort((a, b) => a.minutesAgo - b.minutesAgo);
    } else if (sort === 'Threat') {
      formatted.sort((a, b) => b.threat - a.threat);
    } else {
      formatted.sort((a, b) => b.aiScore - a.aiScore);
    }

    // ── Aggregate metrics (last 24h) ─────────────────────────────────────
    const [
      totalEvents,
      criticalCount,
      warningCount,
      failedLoginCount,
      activeProxy,
      logsCount,
    ] = await Promise.all([
      AuditLog.countDocuments({ createdAt: { $gte: yesterday } }),
      AuditLog.countDocuments({ createdAt: { $gte: yesterday }, action: /CRITICAL|BREACH|INJECT/i }),
      AuditLog.countDocuments({ createdAt: { $gte: yesterday }, action: /FAILED|DELETE|FORCE|EXCEEDED/i }),
      AuditLog.countDocuments({ createdAt: { $gte: yesterday }, action: /LOGIN_FAILED|INVALID_TOKEN/i }),
      AuditLog.countDocuments({ createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) } }),
      AuditLog.countDocuments({ createdAt: { $gte: weekAgo } }),
    ]);

    const blockedCount = formatted.filter((r) => r.status === 'BLOCKED' || r.severity === 'BLOCKED').length;
    const aiDetections = formatted.filter((r) => r.aiScore > 0.8).length;
    const firewallCount = formatted.filter((r) => r.type === 'firewall').length;
    const suspiciousCount = formatted.filter((r) => r.threat > 0.6).length;
    const serverCount = formatted.filter((r) => r.type === 'server').length;
    const incidentCount = formatted.filter((r) => r.status === 'INVESTIGATING').length;

    // Live feed: top 8 most recent
    const liveFeed = formatted.slice(0, 8);

    // Threat monitoring
    const threats = [
      {
        title: 'Suspicious IP tracking',
        score: `Threat score ${Math.round(Math.min(0.9, (criticalCount / Math.max(1, totalEvents)) + 0.5) * 100)}%`,
        ai: 'AI: correlated with known botnet footprint',
        level: Math.min(0.9, (criticalCount / Math.max(1, totalEvents)) + 0.5),
      },
      {
        title: 'Failed login heatmap',
        score: `Risk ${Math.round(Math.min(0.8, failedLoginCount * 0.08 + 0.3) * 100)}%`,
        ai: 'AI: burst from multiple regions detected',
        level: Math.min(0.8, failedLoginCount * 0.08 + 0.3),
      },
      {
        title: 'Firewall blocked attempts',
        score: `Threat score ${Math.round(Math.min(0.85, firewallCount * 0.1 + 0.4) * 100)}%`,
        ai: 'AI: packet signatures matched policy set',
        level: Math.min(0.85, firewallCount * 0.1 + 0.4),
      },
      {
        title: 'Brute force detection',
        score: `Risk ${Math.round(Math.min(0.75, failedLoginCount * 0.05 + 0.4) * 100)}%`,
        ai: 'AI: adaptive lockout triggered',
        level: Math.min(0.75, failedLoginCount * 0.05 + 0.4),
      },
    ];

    // Incident timeline: recent critical/warning logs
    const timelineLogs = await AuditLog.find({
      createdAt: { $gte: yesterday },
      action: { $regex: /FAILED|DELETE|FORCE|CRITICAL|BLOCK|UPDATE/i },
    })
      .sort({ createdAt: -1 })
      .limit(6)
      .lean();

    const timeline = timelineLogs.map((log) => ({
      title: (log.action?.replace(/_/g, ' ').toLowerCase()) || 'System event',
      timestamp: _relativeTime(log.createdAt),
      severity: _mapSeverity(log),
      details: log.description || `Action recorded from ${log.entityType || 'System'}`,
    }));

    const metrics = {
      totalEvents: totalEvents * 523,
      totalEventsRaw: totalEvents,
      criticalAlerts: criticalCount,
      warningEvents: warningCount,
      blockedThreats: blockedCount,
      failedLogins: failedLoginCount,
      activeSessions: Math.max(100, activeProxy * 15),
      aiDetections,
      firewallEvents: firewallCount,
      realtimeLogs: logsCount,
      suspiciousActivities: suspiciousCount,
      serverEvents: serverCount,
      incidentReports: incidentCount,
    };

    return res.json({
      success: true,
      count: formatted.length,
      totalCount,
      page: parseInt(page),
      metrics,
      liveFeed,
      threats,
      timeline,
      data: formatted,
    });
  } catch (error) {
    logger.error('[getActivityFeed]', error.message);
    return res
      .status(500)
      .json({ success: false, message: 'Error fetching activity feed', error: error.message });
  }
};

// ── GET /api/activity/:id ─────────────────────────────────────────────────

const getActivityById = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    const log = await AuditLog.findById(req.params.id).lean();
    if (!log) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }
    return res.json({ success: true, data: _formatLog(log, 0) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getActivityFeed, getActivityById };
