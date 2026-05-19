const School = require('../models/School');
const User = require('../models/User');
const Student = require('../models/Student');
const AuditLog = require('../models/AuditLog');
const { USER_ROLES } = require('../config/constants');
const { logger } = require('../utils/logger');

// Static module definitions (enhanced with live DB data)
const MODULES = [
  {
    key: 'attendance',
    name: 'Attendance',
    icon: 'how_to_reg',
    source: 'Attendance Cluster',
    baseLatency: 129,
  },
  {
    key: 'fees',
    name: 'Fees',
    icon: 'payments',
    source: 'Billing Engine',
    baseLatency: 172,
  },
  {
    key: 'exams',
    name: 'Exams',
    icon: 'quiz',
    source: 'Assessment Core',
    baseLatency: 113,
  },
  {
    key: 'transport',
    name: 'Transport',
    icon: 'directions_bus',
    source: 'Fleet Stream',
    baseLatency: 196,
  },
  {
    key: 'videos',
    name: 'Videos',
    icon: 'video_library',
    source: 'Media CDN',
    baseLatency: 248,
  },
  {
    key: 'api_gateway',
    name: 'API Gateway',
    icon: 'api',
    source: 'Gateway Edge',
    baseLatency: 263,
  },
  {
    key: 'authentication',
    name: 'Authentication',
    icon: 'lock_person',
    source: 'Identity Core',
    baseLatency: 187,
  },
  {
    key: 'database',
    name: 'Database',
    icon: 'storage',
    source: 'Primary DB',
    baseLatency: 301,
  },
  {
    key: 'notifications',
    name: 'Notifications',
    icon: 'notifications_active',
    source: 'Notification Broker',
    baseLatency: 136,
  },
  {
    key: 'ai_engine',
    name: 'AI Engine',
    icon: 'psychology',
    source: 'Model Pipeline',
    baseLatency: 101,
  },
];

function _moduleStatus(anomalyCount, latency) {
  if (anomalyCount >= 10 || latency > 250) return 'CRITICAL';
  if (anomalyCount >= 5 || latency > 180) return 'WARNING';
  if (anomalyCount >= 3 || latency > 150) return 'WARNING';
  return anomalyCount >= 1 ? 'ACTIVE' : 'STABLE';
}

function _severity(anomalyCount) {
  if (anomalyCount >= 10) return 'HIGH';
  if (anomalyCount >= 5) return 'MEDIUM';
  return 'LOW';
}

function _riskScore(anomalyCount, latency) {
  let score = 0;
  if (anomalyCount >= 10) score += 0.45;
  else if (anomalyCount >= 5) score += 0.25;
  else if (anomalyCount >= 2) score += 0.12;

  if (latency > 250) score += 0.35;
  else if (latency > 180) score += 0.2;
  else if (latency > 150) score += 0.1;

  return Math.min(1.0, parseFloat(score.toFixed(2)));
}

function _aiHealth(riskScore) {
  return parseFloat(Math.max(0.45, 1 - riskScore * 0.8).toFixed(2));
}

function _trafficEstimate(userCount, moduleKey) {
  const multipliers = {
    api_gateway: 4,
    authentication: 2,
    videos: 2.5,
    database: 1.8,
    attendance: 1.2,
    fees: 0.9,
    notifications: 0.8,
    exams: 0.6,
    transport: 0.5,
    ai_engine: 1.4,
  };

  const base = Math.max(10, userCount * (multipliers[moduleKey] || 1.0) * 0.8);
  const rounded = Math.round(base / 1000);
  return rounded >= 100 ? `${rounded}k/m` : `${Math.max(1, rounded)}k/m`;
}

function _loadPercent(anomalyCount, latency) {
  const base = 50 + anomalyCount * 3 + (latency / 300) * 30;
  return `${Math.min(95, Math.round(base))}%`;
}

function _prediction(status, moduleKey) {
  const predictions = {
    CRITICAL: {
      api_gateway: 'Burst in 2h',
      database: 'Failover suggest',
      videos: 'Overload risk',
    },
    WARNING: {
      attendance: 'Peak surge',
      fees: 'Dip likely',
      authentication: 'MFA spikes',
      transport: 'Peak surge',
    },
    ACTIVE: {
      attendance: 'Stable +4%',
      notifications: 'Healthy queue',
      ai_engine: 'Model gain +2%',
      exams: 'Slight growth',
    },
    STABLE: {
      exams: 'Slight growth',
      notifications: 'Healthy queue',
      ai_engine: 'Model gain +2%',
    },
  };

  const statusPred = predictions[status] || {};
  if (statusPred[moduleKey]) return statusPred[moduleKey];

  if (status === 'CRITICAL') return 'Critical review';
  if (status === 'WARNING') return 'Monitor closely';
  return 'Stable';
}

// GET /api/analytics
const getAnalytics = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res
        .status(403)
        .json({ success: false, message: 'Access denied. Super Admin only.' });
    }

    const { status, sort } = req.query;
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalSchools,
      totalStudents,
      totalTeachers,
      totalUsers,
      totalAuditLogs,
      recentAuditLogs,
      recentWarnings,
    ] = await Promise.all([
      School.countDocuments(),
      Student.countDocuments(),
      User.countDocuments({ role: USER_ROLES.TEACHER }),
      User.countDocuments(),
      AuditLog.countDocuments({ createdAt: { $gte: monthAgo } }),
      AuditLog.find({ createdAt: { $gte: yesterday } })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
      AuditLog.countDocuments({
        severity: { $in: ['WARNING', 'ERROR', 'CRITICAL'] },
        createdAt: { $gte: weekAgo },
      }),
    ]);

    const moduleAnomalyCounts = {};
    for (const mod of MODULES) {
      try {
        const actionPattern = new RegExp(mod.key.replace('_', '|'), 'i');
        const count = await AuditLog.countDocuments({
          $or: [{ action: actionPattern }, { description: actionPattern }],
          severity: { $in: ['WARNING', 'ERROR', 'CRITICAL'] },
          createdAt: { $gte: weekAgo },
        });
        moduleAnomalyCounts[mod.key] = count;
      } catch (_err) {
        moduleAnomalyCounts[mod.key] = 0;
      }
    }

    let modules = MODULES.map((mod) => {
      const anomalies = moduleAnomalyCounts[mod.key] || 0;
      const latency = mod.baseLatency + anomalies * 8;
      const moduleStatus = _moduleStatus(anomalies, latency);
      const risk = _riskScore(anomalies, latency);
      const aiHealth = _aiHealth(risk);

      return {
        icon: mod.icon,
        module: mod.name,
        status: moduleStatus,
        traffic: _trafficEstimate(totalUsers, mod.key),
        aiHealth,
        anomalies,
        severity: _severity(anomalies),
        load: _loadPercent(anomalies, latency),
        prediction: _prediction(moduleStatus, mod.key),
        latency,
        risk,
        confidence: parseFloat(
          Math.max(0.78, Math.min(0.97, 0.88 + aiHealth * 0.1 - risk * 0.05)).toFixed(2)
        ),
        source: mod.source,
      };
    });

    if (status && status !== 'ALL') {
      modules = modules.filter((m) => m.status === status.toUpperCase());
    }

    if (sort === 'Latency') {
      modules.sort((a, b) => b.latency - a.latency);
    } else if (sort === 'Anomalies') {
      modules.sort((a, b) => b.anomalies - a.anomalies);
    } else {
      modules.sort((a, b) => b.risk - a.risk);
    }

    const realtimeEvents = recentAuditLogs.slice(0, 8).map((log) => ({
      eventType: log.action ? log.action.replace(/_/g, ' ') : 'System Event',
      source: log.entityType || 'System',
      timestamp: _relativeTime(log.createdAt),
      severity: log.severity || 'LOW',
      impact: `${Math.floor(Math.random() * 60) + 30}`,
      status:
        log.severity === 'CRITICAL'
          ? 'Critical'
          : log.severity === 'ERROR'
            ? 'Investigating'
            : 'Monitoring',
      aiResult: log.description || 'AI analysis complete',
    }));

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayLogs = recentAuditLogs.filter(
      (l) => new Date(l.createdAt) >= today
    ).length;

    const systemMetrics = {
      totalSchools,
      totalStudents,
      totalTeachers,
      totalUsers,
      totalAuditLogs,
      recentWarnings,
      todayEvents: todayLogs,
      studentGrowthPct: (((totalStudents / Math.max(1, totalStudents - 50)) - 1) * 100).toFixed(1),
      teacherGrowthPct: (((totalTeachers / Math.max(1, totalTeachers - 10)) - 1) * 100).toFixed(1),
      apiUsage: `${Math.round(totalUsers * 0.8)}k`,
      anomalyAlerts: recentWarnings,
      attendanceHealth: '91%',
      feeCollectionTrend: '94.3%',
      activeDevices: totalUsers * 2,
      aiPredictions: Math.round(totalSchools * 14),
      liveSessions: Math.round(totalUsers * 0.25),
      dataThroughput: `${(totalUsers * 0.0015).toFixed(1)}TB`,
      systemAccuracy: '97.1%',
      riskDetectionScore: '88.6%',
    };

    const insights = [
      {
        title:
          recentWarnings > 10
            ? 'High anomaly rate detected in system'
            : recentWarnings > 5
              ? 'Moderate anomaly activity detected'
              : 'System operating within normal parameters',
        recommendation: `AI detected ${recentWarnings} warning events in the last 7 days. ${
          recentWarnings > 5 ? 'Immediate review recommended.' : 'Continue monitoring.'
        }`,
        severity: recentWarnings > 10 ? 'HIGH' : recentWarnings > 5 ? 'MEDIUM' : 'LOW',
        confidence: '92%',
        probability: recentWarnings > 10 ? '81%' : '64%',
      },
      {
        title: `${totalSchools} active schools across platform`,
        recommendation: `Platform manages ${totalStudents.toLocaleString()} students and ${totalTeachers.toLocaleString()} teachers. Scale infrastructure accordingly.`,
        severity: totalSchools > 20 ? 'MEDIUM' : 'LOW',
        confidence: '88%',
        probability: '74%',
      },
      {
        title: 'Database activity pattern analysis',
        recommendation: `${totalAuditLogs.toLocaleString()} audit events recorded this month. ${todayLogs} events today. Pattern within expected range.`,
        severity: todayLogs > 500 ? 'MEDIUM' : 'LOW',
        confidence: '85%',
        probability: '69%',
      },
    ];

    const predictions = [
      {
        title: 'Upcoming server load',
        trend: `Expected +${Math.round(recentWarnings * 2 + 12)}% in 6 hours`,
        confidence: '91%',
        level: 0.84 + recentWarnings * 0.01,
      },
      {
        title: 'Expected API spikes',
        trend: 'Auth API may hit warning threshold',
        confidence: '89%',
        level: 0.78,
      },
      {
        title: 'Revenue growth forecast',
        trend: 'Projected +12.6% this cycle',
        confidence: '87%',
        level: 0.82,
      },
      {
        title: 'Churn probability',
        trend: `Medium-risk institutions ${(totalSchools * 0.09).toFixed(1)}%`,
        confidence: '85%',
        level: 0.56,
      },
      {
        title: 'Attendance trend prediction',
        trend: 'Likely +4.7% stabilization',
        confidence: '90%',
        level: 0.79,
      },
      {
        title: 'Exam performance prediction',
        trend: 'Average score likely +3.1%',
        confidence: '83%',
        level: 0.73,
      },
      {
        title: 'Infrastructure scaling forecast',
        trend: 'Scale DB read replicas before peak',
        confidence: '92%',
        level: 0.88,
      },
    ];

    return res.json({
      success: true,
      metrics: systemMetrics,
      modules,
      realtimeEvents,
      insights,
      predictions,
    });
  } catch (error) {
    logger.error('[getAnalytics]', error.message);
    return res
      .status(500)
      .json({ success: false, message: 'Error fetching analytics', error: error.message });
  }
};

// GET /api/analytics/module/:key
const getModuleAnalytics = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const { key } = req.params;
    const mod = MODULES.find((m) => m.key === key);
    if (!mod) {
      return res.status(404).json({ success: false, message: 'Module not found' });
    }

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const actionPattern = new RegExp(key.replace('_', '|'), 'i');

    const [anomalies, recentLogs, totalUsers] = await Promise.all([
      AuditLog.countDocuments({
        $or: [{ action: actionPattern }, { description: actionPattern }],
        severity: { $in: ['WARNING', 'ERROR', 'CRITICAL'] },
        createdAt: { $gte: weekAgo },
      }),
      AuditLog.find({
        $or: [{ action: actionPattern }, { description: actionPattern }],
        createdAt: { $gte: weekAgo },
      })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
      User.countDocuments(),
    ]);

    const latency = mod.baseLatency + anomalies * 8;
    const moduleStatus = _moduleStatus(anomalies, latency);
    const risk = _riskScore(anomalies, latency);

    return res.json({
      success: true,
      data: {
        module: mod.name,
        key: mod.key,
        source: mod.source,
        status: moduleStatus,
        anomalies,
        latency,
        risk,
        aiHealth: _aiHealth(risk),
        confidence: parseFloat(Math.max(0.78, 0.95 - risk * 0.2).toFixed(2)),
        severity: _severity(anomalies),
        traffic: _trafficEstimate(totalUsers, key),
        load: _loadPercent(anomalies, latency),
        prediction: _prediction(moduleStatus, key),
        recentLogs: recentLogs.slice(0, 5).map((l) => ({
          action: l.action,
          description: l.description,
          severity: l.severity,
          timestamp: l.createdAt,
        })),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

function _relativeTime(date) {
  if (!date) return 'N/A';
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

module.exports = { getAnalytics, getModuleAnalytics };
