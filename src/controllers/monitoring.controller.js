const mongoose = require('mongoose');
const os = require('os');
const InfrastructureMetric = require('../models/InfrastructureMetric');
const School = require('../models/School');
const LoginSession = require('../models/LoginSession');

const getInfraMetrics = async (req, res) => {
  try {
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit || '288', 10)));
    const rows = await InfrastructureMetric.find()
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    return res.json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    console.error('[getInfraMetrics]', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getLiveMetrics = async (req, res) => {
  try {
    const [activeSchools, onlineUsers, latest] = await Promise.all([
      School.countDocuments({ isDeleted: false, status: 'active' }),
      LoginSession.countDocuments({
        isActive: true,
        lastActiveAt: { $gte: new Date(Date.now() - 30 * 60000) }
      }),
      InfrastructureMetric.findOne().sort({ timestamp: -1 }).lean()
    ]);

    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    return res.json({
      success: true,
      data: {
        timestamp: new Date(),
        cpuUsagePct: Math.round(os.loadavg()[0] * 10),
        ramUsagePct: Math.round(((totalMem - freeMem) / totalMem) * 100),
        dbConnected: mongoose.connection.readyState === 1,
        dbLatencyMs: latest?.dbLatencyMs || 0,
        apiLatencyMs: latest?.apiLatencyMs || 0,
        requestsPerMin: latest?.requestsPerMin || 0,
        errorRate: latest?.errorRate || 0,
        activeSchools,
        onlineUsers,
        backupStatus: latest?.backupStatus || 'PENDING'
      }
    });
  } catch (error) {
    console.error('[getLiveMetrics]', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getJobQueueStatus = async (_req, res) => {
  return res.json({
    success: true,
    data: {
      queues: [
        { name: 'automation', status: 'RUNNING' },
        { name: 'backup', status: 'RUNNING' },
        { name: 'notifications', status: 'RUNNING' },
        { name: 'reports', status: 'RUNNING' }
      ]
    }
  });
};

module.exports = { getInfraMetrics, getLiveMetrics, getJobQueueStatus };
