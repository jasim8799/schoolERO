import AuditLog from '../models/AuditLog.js';
import { logger } from './logger.js';

/**
 * Create an audit log entry
 * @param {Object} options - Audit log options
 * @param {string} options.action - Action performed
 * @param {string} options.userId - User who performed the action
 * @param {string} options.schoolId - School ID (optional)
 * @param {string} options.targetUserId - Target user ID (optional)
 * @param {Object} options.details - Additional details (optional)
 * @param {Object} options.req - Express request object (optional)
 */
export const createAuditLog = async (options) => {
  try {
    const { action, userId, schoolId, targetUserId, details, req } = options;

    const auditData = {
      action,
      userId,
      schoolId: schoolId || null,
      targetUserId: targetUserId || null,
      details: details || {},
      ipAddress: req?.ip || req?.connection?.remoteAddress || null,
      userAgent: req?.headers?.['user-agent'] || null
    };

    await AuditLog.create(auditData);
    logger.info(`Audit log created: ${action} by user ${userId}`);
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
 * @param {number} filters.limit - Limit results
 * @param {number} filters.skip - Skip results
 */
export const getAuditLogs = async (filters = {}) => {
  try {
    const { userId, schoolId, action, limit = 50, skip = 0 } = filters;

    const query = {};
    if (userId) query.userId = userId;
    if (schoolId) query.schoolId = schoolId;
    if (action) query.action = action;

    const logs = await AuditLog.find(query)
      .populate('userId', 'name email role')
      .populate('schoolId', 'name code')
      .populate('targetUserId', 'name email')
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip);

    return logs;
  } catch (error) {
    logger.error('Error fetching audit logs:', error.message);
    throw error;
  }
};
