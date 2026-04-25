const AuditLog = require('../models/AuditLog');
const { logger } = require('./logger');

/**
 * Create an audit log entry
 * @param {Object} options - Audit log options
 * @param {string} options.action - Action performed
 * @param {string} options.userId - User who performed the action
 * @param {string} options.role - User's role
 * @param {string} options.entityType - Type of entity affected
 * @param {string} options.entityId - ID of entity affected (optional)
 * @param {string} options.description - Human-readable description
 * @param {string} options.schoolId - School ID (optional)
 * @param {string} options.sessionId - Session ID (optional)
 * @param {Object} options.details - Additional details (optional)
 * @param {Object} options.req - Express request object (optional)
 */
const auditLog = async (options) => {
  try {
    const {
      action,
      userId,
      role,
      entityType,
      entityId,
      description,
      schoolId,
      sessionId,
      details,
      req
    } = options;

    const auditData = {
      action,
      userId: userId || null,
      role: role || 'SYSTEM',
      entityType: entityType || 'SYSTEM',
      entityId: entityId || null,
      description: description || action,
      schoolId: schoolId || null,
      sessionId: sessionId || null,
      ipAddress: req?.ip || req?.connection?.remoteAddress || 'SYSTEM',
      details: details || {}
    };

    await AuditLog.create(auditData);
    logger.info(`Audit log created: ${action} by ${role} ${userId}`);
  } catch (error) {
    logger.error('Error creating audit log:', error.message);
    // Don't throw error - audit log failure shouldn't break the main operation
  }
};

/**
 * Get audit logs with filters
 * @param {Object} filters - Filter options
 * @param {string} filters.userId - Filter by user
 * @param {string} filters.schoolId - Filter by school
 * @param {string} filters.action - Filter by action
 * @param {string} filters.entityType - Filter by entity type
 * @param {Date} filters.startDate - Start date for filtering
 * @param {Date} filters.endDate - End date for filtering
 * @param {number} filters.limit - Limit results
 * @param {number} filters.skip - Skip results
 */
const getAuditLogs = async (filters = {}) => {
  try {
    const {
      userId,
      schoolId,
      action,
      entityType,
      startDate,
      endDate,
      limit = 50,
      skip = 0
    } = filters;

    const query = {};
    if (userId) query.userId = userId;
    if (schoolId) query.schoolId = schoolId;
    if (action) {
      // Support MongoDB $in queries (e.g. for level=error filter)
      query.action = (typeof action === 'object' && action.$in) ? action : action;
    }
    if (entityType) query.entityType = entityType;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = startDate;
      if (endDate) query.createdAt.$lte = endDate;
    }

    const logs = await AuditLog.find(query)
      .populate('userId', 'name email')
      .populate('schoolId', 'name code')
      .populate('sessionId', 'name')
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip);

    return logs;
  } catch (error) {
    logger.error('Error fetching audit logs:', error.message);
    throw error;
  }
};

/**
 * Log an error to the AuditLog (non-blocking, never throws)
 */
const logError = async ({ req, error, entityType = 'ERROR', context = '' }) => {
  try {
    const ip = req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
      || req?.socket?.remoteAddress
      || req?.ip
      || '0.0.0.0';
    await AuditLog.create({
      userId: req?.user?._id || req?.user?.userId || null,
      role: req?.user?.role || 'SYSTEM',
      action: 'ERROR_OCCURRED',
      entityType,
      description: `Error: ${error?.message || String(error)}`,
      details: {
        stack: error?.stack?.substring(0, 500),
        context,
        url: req?.originalUrl,
        method: req?.method,
      },
      ipAddress: ip,
      schoolId: req?.user?.schoolId || null,
    });
  } catch (_) {} // Never throw from error logger
};

module.exports = {
  auditLog,
  getAuditLogs,
  logError
};
