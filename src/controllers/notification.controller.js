const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');
const School = require('../models/School');
const User = require('../models/User');
const redis = require('../config/redis');

const withTimeout = (promise, fallback) => Promise.race([
  promise,
  new Promise((resolve) => setTimeout(() => resolve(fallback), 5000)),
]).catch(() => fallback);

function _alertColor(severity) {
  const s = String(severity || '').toUpperCase();
  if (s === 'CRITICAL') return 'red';
  if (s === 'HIGH') return 'orange';
  if (s === 'MEDIUM') return 'purple';
  return 'cyan';
}

exports.getSystemAlerts = async (req, res) => {
  try {
    if (req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const cacheKey = 'system:alerts:v1';
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) return res.json({ success: true, ...JSON.parse(cached), cached: true });

    const now = new Date();
    const hourAgo = new Date(now.getTime() - 3600000);
    const dayAgo = new Date(now.getTime() - 86400000);
    const fiveMinAgo = new Date(now.getTime() - 5 * 60000);
    const thirtyMinAgo = new Date(now.getTime() - 30 * 60000);

    const [failedLogs, feeWarnings, apiSpikeCount, attendanceLogs, offlineSchools, schoolsCount, usersCount] = await Promise.all([
      withTimeout(AuditLog.countDocuments({ createdAt: { $gte: hourAgo }, action: { $in: ['LOGIN_FAILED', 'INVALID_TOKEN'] } }), 0),
      withTimeout(AuditLog.countDocuments({ createdAt: { $gte: dayAgo }, severity: 'WARNING', action: { $regex: /PAYMENT|FEE|BILL/i } }), 0),
      withTimeout(AuditLog.countDocuments({ createdAt: { $gte: fiveMinAgo } }), 0),
      withTimeout(AuditLog.countDocuments({ createdAt: { $gte: dayAgo }, action: { $regex: /ATTENDANCE/i } }), 0),
      withTimeout(School.find({ $or: [{ lastHeartbeat: { $exists: false } }, { lastHeartbeat: null }, { lastHeartbeat: { $lt: thirtyMinAgo } }] }).select('_id name code lastHeartbeat').lean(), []),
      withTimeout(School.countDocuments({ isDeleted: { $ne: true } }), 0),
      withTimeout(User.countDocuments({ isDeleted: { $ne: true } }), 0),
    ]);

    const recentFailedBurst = await withTimeout(
      AuditLog.find({ createdAt: { $gte: hourAgo }, action: { $in: ['LOGIN_FAILED', 'INVALID_TOKEN'] } })
        .sort({ createdAt: -1 })
        .limit(25)
        .select('ipAddress createdAt action description')
        .lean(),
      []
    );

    const alerts = [];

    if (failedLogs > 5) {
      const ip = recentFailedBurst[0]?.ipAddress || '103.44.x.x';
      alerts.push({
        _id: `security-${failedLogs}`,
        title: 'AI Risk Spike',
        subtitle: `Suspicious login burst from ${ip}`,
        color: 'red',
        icon: 'gpp_bad',
        severity: 'CRITICAL',
        category: 'SECURITY',
        createdAt: recentFailedBurst[0]?.createdAt || now.toISOString(),
        acknowledged: false,
      });
    }

    offlineSchools.slice(0, 3).forEach((school) => {
      alerts.push({
        _id: `school-${school._id}`,
        title: 'School Offline',
        subtitle: `${school.name} heartbeat stale`,
        color: 'orange',
        icon: 'wifi_off',
        severity: 'HIGH',
        category: 'OPERATIONS',
        createdAt: school.lastHeartbeat || now.toISOString(),
        acknowledged: false,
      });
    });

    if (feeWarnings > 0) {
      alerts.push({
        _id: `fee-${feeWarnings}`,
        title: 'Fee Anomaly',
        subtitle: 'Warning-level payment activity detected',
        color: 'purple',
        icon: 'payments',
        severity: 'MEDIUM',
        category: 'BILLING',
        createdAt: now.toISOString(),
        acknowledged: false,
      });
    }

    if (apiSpikeCount > 50) {
      alerts.push({
        _id: `api-${apiSpikeCount}`,
        title: 'API Spike',
        subtitle: `${apiSpikeCount} audit events in the last 5 minutes`,
        color: 'cyan',
        icon: 'api',
        severity: 'HIGH',
        category: 'API',
        createdAt: now.toISOString(),
        acknowledged: false,
      });
    }

    if (attendanceLogs > 0) {
      alerts.push({
        _id: `attendance-${attendanceLogs}`,
        title: 'Attendance Drop',
        subtitle: 'Attendance anomaly indicators detected',
        color: 'teal',
        icon: 'groups',
        severity: 'MEDIUM',
        category: 'ACADEMIC',
        createdAt: now.toISOString(),
        acknowledged: false,
      });
    }

    alerts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const payload = {
      count: alerts.length,
      data: alerts,
      summary: {
        schoolsCount,
        usersCount,
        activeSecurityAlerts: alerts.filter((a) => a.category === 'SECURITY').length,
      },
      meta: {
        generatedAt: now.toISOString(),
        colorMap: {
          red: _alertColor('CRITICAL'),
          orange: _alertColor('HIGH'),
          purple: _alertColor('MEDIUM'),
          cyan: _alertColor('LOW'),
        },
      },
    };

    await redis.setex(cacheKey, 60, JSON.stringify(payload)).catch(() => {});
    return res.json({ success: true, ...payload });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/notifications/queue
 * Query: status, type, limit, page
 */
exports.getQueue = async (req, res) => {
  try {
    const NotificationQueue = mongoose.model('NotificationQueue');
    const { status, type, limit = 50, page = 1 } = req.query;

    const filter = { schoolId: req.schoolId };
    if (status) filter.status = status;
    if (type) filter.type = type;

    const skip = (Number(page) - 1) * Number(limit);
    const [notifications, total] = await Promise.all([
      NotificationQueue.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate('recipientId', 'name email')
        .lean(),
      NotificationQueue.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: notifications,
      pagination: { total, page: Number(page), limit: Number(limit) }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/notifications/send
 * Processes PENDING notifications (up to batchSize).
 * In production, hook this into FCM / SMS / email gateway.
 * Body: { batchSize }
 */
exports.processSend = async (req, res) => {
  try {
    const NotificationQueue = mongoose.model('NotificationQueue');
    const batchSize = Number(req.body.batchSize) || 100;

    const pending = await NotificationQueue.find({
      schoolId: req.schoolId,
      status: 'PENDING',
      retryCount: { $lt: 3 }
    })
      .limit(batchSize)
      .lean();

    const results = { sent: 0, failed: 0 };

    for (const notif of pending) {
      try {
        // TODO: integrate FCM / SMS / email gateway here
        // For now, mark as SENT directly
        await NotificationQueue.findByIdAndUpdate(notif._id, {
          status: 'SENT',
          sentAt: new Date()
        });
        results.sent++;
      } catch (sendErr) {
        await NotificationQueue.findByIdAndUpdate(notif._id, {
          $inc: { retryCount: 1 },
          errorMessage: sendErr.message,
          ...(notif.retryCount + 1 >= 3 ? { status: 'FAILED' } : {})
        });
        results.failed++;
      }
    }

    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/notifications/manual
 * Send a manual notification to a specific user.
 * Body: { recipientId, recipientRole, type, title, body, relatedEntityId, relatedEntityType }
 */
exports.sendManual = async (req, res) => {
  try {
    const NotificationQueue = mongoose.model('NotificationQueue');
    const { recipientId, recipientRole, type, title, body, relatedEntityId, relatedEntityType } = req.body;

    const notif = await NotificationQueue.create({
      schoolId: req.schoolId,
      recipientId,
      recipientRole,
      type: type || 'GENERAL',
      title,
      body,
      relatedEntityId,
      relatedEntityType
    });
    res.status(201).json({ success: true, data: notif });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};
