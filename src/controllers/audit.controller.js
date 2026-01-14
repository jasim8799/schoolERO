const { getAuditLogs } = require('../utils/auditLog');
const { USER_ROLES } = require('../config/constants');

/**
 * Get audit logs with role-based filtering
 * - Principal: Can view only their school's logs
 * - Super Admin: Can view all logs
 * - Others: Access denied
 */
const getAuditLogsController = async (req, res) => {
  try {
    const { role, schoolId } = req.user;
    const {
      action,
      entityType,
      startDate,
      endDate,
      limit = 50,
      skip = 0
    } = req.query;

    // Role-based access control
    if (role !== USER_ROLES.PRINCIPAL && role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Insufficient permissions.'
      });
    }

    // Build filters based on role
    const filters = {
      action: action || undefined,
      entityType: entityType || undefined,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      limit: parseInt(limit),
      skip: parseInt(skip)
    };

    // Principal can only see their school's logs
    if (role === USER_ROLES.PRINCIPAL) {
      filters.schoolId = schoolId;
    }
    // Super Admin can see all logs (no schoolId filter)

    const logs = await getAuditLogs(filters);

    // Get total count for pagination
    const totalCount = await getAuditLogsCount(filters);

    res.json({
      success: true,
      data: {
        logs,
        pagination: {
          total: totalCount,
          limit: filters.limit,
          skip: filters.skip,
          hasMore: (filters.skip + filters.limit) < totalCount
        }
      }
    });

  } catch (error) {
    console.error('Error in getAuditLogsController:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve audit logs',
      error: error.message
    });
  }
};

/**
 * Get audit logs count for pagination
 */
const getAuditLogsCount = async (filters) => {
  try {
    const AuditLog = require('../models/AuditLog');

    const query = {};
    if (filters.userId) query.userId = filters.userId;
    if (filters.schoolId) query.schoolId = filters.schoolId;
    if (filters.action) query.action = filters.action;
    if (filters.entityType) query.entityType = filters.entityType;
    if (filters.startDate || filters.endDate) {
      query.createdAt = {};
      if (filters.startDate) query.createdAt.$gte = filters.startDate;
      if (filters.endDate) query.createdAt.$lte = filters.endDate;
    }

    return await AuditLog.countDocuments(query);
  } catch (error) {
    console.error('Error getting audit logs count:', error);
    return 0;
  }
};

/**
 * Get audit log statistics (Super Admin only)
 */
const getAuditStatsController = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Super Admin only.'
      });
    }

    const AuditLog = require('../models/AuditLog');

    // Get stats for last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      totalLogs,
      recentLogs,
      actionStats,
      roleStats,
      entityStats
    ] = await Promise.all([
      AuditLog.countDocuments(),
      AuditLog.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      AuditLog.aggregate([
        { $group: { _id: '$action', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]),
      AuditLog.aggregate([
        { $group: { _id: '$role', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      AuditLog.aggregate([
        { $group: { _id: '$entityType', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ])
    ]);

    res.json({
      success: true,
      data: {
        totalLogs,
        recentLogs,
        topActions: actionStats,
        roleDistribution: roleStats,
        topEntities: entityStats
      }
    });

  } catch (error) {
    console.error('Error in getAuditStatsController:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve audit statistics',
      error: error.message
    });
  }
};

module.exports = {
  getAuditLogsController,
  getAuditStatsController
};
