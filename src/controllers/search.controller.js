const School = require('../models/School');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const redis = require('../config/redis');

const safeQuery = (promise, fallback) => Promise.race([
  promise,
  new Promise((resolve) => setTimeout(() => resolve(fallback), 5000)),
]).catch(() => fallback);

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

exports.globalSearch = async (req, res) => {
  try {
    if (req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const query = String(req.query.q || req.body?.q || '').trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit || '8', 10) || 8, 1), 20);
    const cacheKey = `global:search:${query.toLowerCase()}:${limit}`;
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) {
      return res.json({ success: true, data: JSON.parse(cached), cached: true });
    }

    const regex = query ? new RegExp(escapeRegex(query), 'i') : null;

    const [schools, users, logs] = await Promise.all([
      safeQuery(
        query
          ? School.find({
              isDeleted: { $ne: true },
              $or: [
                { name: regex },
                { code: regex },
                { city: regex },
                { board: regex },
              ],
            })
              .select('name code status plan riskLevel updatedAt')
              .sort({ updatedAt: -1 })
              .limit(limit)
              .lean()
          : School.find({ isDeleted: { $ne: true } })
              .select('name code status plan riskLevel updatedAt')
              .sort({ updatedAt: -1 })
              .limit(limit)
              .lean(),
        []
      ),
      safeQuery(
        query
          ? User.find({
              isDeleted: { $ne: true },
              $or: [
                { name: regex },
                { email: regex },
                { phone: regex },
              ],
            })
              .select('name email role status createdAt')
              .sort({ createdAt: -1 })
              .limit(limit)
              .lean()
          : User.find({ isDeleted: { $ne: true } })
              .select('name email role status createdAt')
              .sort({ createdAt: -1 })
              .limit(limit)
              .lean(),
        []
      ),
      safeQuery(
        query
          ? AuditLog.find({
              $or: [
                { action: regex },
                { description: regex },
                { ipAddress: regex },
              ],
            })
              .select('action role createdAt userId')
              .sort({ createdAt: -1 })
              .limit(limit)
              .lean()
          : AuditLog.find({})
              .select('action role createdAt userId')
              .sort({ createdAt: -1 })
              .limit(limit)
              .lean(),
        []
      ),
    ]);

    const data = {
      query,
      total: schools.length + users.length + logs.length,
      results: {
        schools: schools.map((school) => ({
          type: 'school',
          id: school._id,
          title: school.name,
          subtitle: `${school.code} · ${school.status}`,
          meta: school.plan,
          route: '/admin/schools',
        })),
        users: users.map((user) => ({
          type: 'user',
          id: user._id,
          title: user.name,
          subtitle: user.email,
          meta: user.role,
          route: '/admin/users',
        })),
        logs: logs.map((log) => ({
          type: 'log',
          id: log._id,
          title: log.action,
          subtitle: `${log.role} · ${new Date(log.createdAt).toLocaleString()}`,
          meta: 'Audit',
          route: '/audit-logs',
        })),
      },
    };

    await redis.setex(cacheKey, 30, JSON.stringify(data)).catch(() => {});
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
