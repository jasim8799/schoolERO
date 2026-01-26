const mongoose = require('mongoose');
const School = require('../models/School');
const User = require('../models/User');
const SystemSettings = require('../models/SystemSettings');
const SystemAnnouncement = require('../models/SystemAnnouncement');
const { HTTP_STATUS, USER_ROLES, SCHOOL_STATUS } = require('../config/constants');
const { logger } = require('../utils/logger');
const { auditLog } = require('../utils/auditLog');

/**
 * Get system-wide metrics for Super Admin dashboard
 */
const getSystemMetrics = async (req, res) => {
  try {
    // School metrics
    const totalSchools = await School.countDocuments();
    const activeSchools = await School.countDocuments({ status: SCHOOL_STATUS.ACTIVE });
    const inactiveSchools = await School.countDocuments({ status: SCHOOL_STATUS.INACTIVE });

    // School plan distribution
    const planDistribution = await School.aggregate([
      { $group: { _id: '$plan', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    // User metrics
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ status: 'active' });
    const usersByRole = await User.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$role', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    // Recent schools (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentSchools = await School.countDocuments({
      createdAt: { $gte: thirtyDaysAgo }
    });

    // Subscription metrics
    const expiredSubscriptions = await School.countDocuments({
      'subscription.isExpired': true
    });

    const expiringSoon = await School.countDocuments({
      'subscription.endDate': {
        $lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Next 30 days
        $gt: new Date()
      }
    });

    // Database connection status
    const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';

    // System uptime (simplified - would need process monitoring in production)
    const uptime = process.uptime();

    // API health check
    const apiHealth = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: dbStatus === 'connected' ? 'healthy' : 'unhealthy',
        api: 'healthy'
      }
    };

    // Recent activity (simplified - would need audit logs)
    const recentActivity = {
      newSchools: recentSchools,
      newUsers: await User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } })
    };

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: {
        overview: {
          totalSchools,
          activeSchools,
          inactiveSchools,
          totalUsers,
          activeUsers,
          expiredSubscriptions,
          expiringSoonSubscriptions: expiringSoon
        },
        schools: {
          total: totalSchools,
          active: activeSchools,
          inactive: inactiveSchools,
          planDistribution,
          recent: recentSchools
        },
        users: {
          total: totalUsers,
          active: activeUsers,
          byRole: usersByRole
        },
        subscriptions: {
          expired: expiredSubscriptions,
          expiringSoon: expiringSoon
        },
        system: {
          uptime: Math.floor(uptime),
          databaseStatus: dbStatus,
          apiHealth
        },
        activity: recentActivity,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Get system metrics error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error fetching system metrics',
      error: error.message
    });
  }
};

/**
 * Get system health status
 */
const getSystemHealth = async (req, res) => {
  try {
    const dbStatus = mongoose.connection.readyState === 1 ? 'healthy' : 'unhealthy';
    const uptime = process.uptime();

    // Check critical services
    const health = {
      status: dbStatus === 'healthy' ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(uptime),
      services: {
        database: {
          status: dbStatus,
          responseTime: Date.now() // Simplified - would measure actual query time
        },
        api: {
          status: 'healthy',
          version: process.env.npm_package_version || '1.0.0'
        }
      },
      metrics: {
        memory: process.memoryUsage(),
        cpu: process.cpuUsage()
      }
    };

    const statusCode = health.status === 'healthy' ? HTTP_STATUS.OK : HTTP_STATUS.INTERNAL_SERVER_ERROR;

    res.status(statusCode).json({
      success: health.status === 'healthy',
      data: health
    });
  } catch (error) {
    logger.error('Get system health error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error fetching system health',
      error: error.message
    });
  }
};

/**
 * Get backup status summary
 */
const getBackupStatus = async (req, res) => {
  try {
    // This would integrate with actual backup system
    // For now, return mock data
    const backupStatus = {
      lastBackup: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours ago
      status: 'completed',
      size: '2.5GB',
      nextScheduled: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
      history: [
        {
          date: new Date(Date.now() - 24 * 60 * 60 * 1000),
          status: 'completed',
          size: '2.5GB',
          type: 'full'
        },
        {
          date: new Date(Date.now() - 48 * 60 * 60 * 1000),
          status: 'completed',
          size: '2.4GB',
          type: 'incremental'
        }
      ]
    };

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: backupStatus
    });
  } catch (error) {
    logger.error('Get backup status error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error fetching backup status',
      error: error.message
    });
  }
};

/**
 * Get maintenance mode status
 */
const getMaintenanceMode = async (req, res) => {
  try {
    let settings = await SystemSettings.findOne();
    if (!settings) {
      settings = await SystemSettings.create({});
    }

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: {
        maintenanceMode: settings.maintenanceMode,
        maintenanceMessage: settings.maintenanceMessage,
        lastUpdatedBy: settings.lastUpdatedBy,
        updatedAt: settings.updatedAt
      }
    });
  } catch (error) {
    logger.error('Get maintenance mode error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error fetching maintenance mode status',
      error: error.message
    });
  }
};

/**
 * Toggle maintenance mode
 */
const toggleMaintenanceMode = async (req, res) => {
  try {
    const { enabled, message } = req.body;

    // Validate inputs
    if (typeof enabled !== 'boolean') {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Enabled must be a boolean value'
      });
    }

    // Get or create settings
    let settings = await SystemSettings.findOne();
    if (!settings) {
      settings = new SystemSettings();
    }

    const oldMode = settings.maintenanceMode;
    const oldMessage = settings.maintenanceMessage;

    // Update settings
    settings.maintenanceMode = enabled;
    if (message !== undefined) {
      settings.maintenanceMessage = message || 'System is currently under maintenance. Please try again later.';
    }
    settings.lastUpdatedBy = req.user.userId;

    await settings.save();

    // Log the action
    await auditLog({
      action: enabled ? 'MAINTENANCE_MODE_ENABLED' : 'MAINTENANCE_MODE_DISABLED',
      userId: req.user.userId,
      role: req.user.role,
      entityType: 'System',
      entityId: null,
      description: `Maintenance mode ${enabled ? 'enabled' : 'disabled'}`,
      details: {
        oldMode,
        newMode: enabled,
        oldMessage,
        newMessage: settings.maintenanceMessage
      },
      req
    });

    logger.success(`Maintenance mode ${enabled ? 'enabled' : 'disabled'} by ${req.user.role}`);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: `Maintenance mode ${enabled ? 'enabled' : 'disabled'} successfully`,
      data: {
        maintenanceMode: settings.maintenanceMode,
        maintenanceMessage: settings.maintenanceMessage,
        updatedAt: settings.updatedAt
      }
    });
  } catch (error) {
    logger.error('Toggle maintenance mode error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error toggling maintenance mode',
      error: error.message
    });
  }
};

/**
 * Create a system announcement
 */
const createSystemAnnouncement = async (req, res) => {
  try {
    const { title, message, priority, targetRoles, expiresAt } = req.body;

    // Validate required fields
    if (!title || !message) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Title and message are required'
      });
    }

    // Create announcement
    const announcement = new SystemAnnouncement({
      title: title.trim(),
      message: message.trim(),
      createdBy: req.user.userId,
      priority: priority || 'medium',
      targetRoles: targetRoles || [], // Empty array means all roles
      expiresAt: expiresAt ? new Date(expiresAt) : null
    });

    await announcement.save();

    // Log the action
    await auditLog({
      action: 'SYSTEM_ANNOUNCEMENT_CREATED',
      userId: req.user.userId,
      role: req.user.role,
      entityType: 'SystemAnnouncement',
      entityId: announcement._id,
      description: `System announcement created: ${title}`,
      details: {
        title,
        priority: announcement.priority,
        targetRoles: announcement.targetRoles,
        expiresAt: announcement.expiresAt
      },
      req
    });

    logger.success(`System announcement created by ${req.user.role}: ${title}`);

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: 'System announcement created successfully',
      data: {
        id: announcement._id,
        title: announcement.title,
        message: announcement.message,
        priority: announcement.priority,
        targetRoles: announcement.targetRoles,
        expiresAt: announcement.expiresAt,
        createdAt: announcement.createdAt
      }
    });
  } catch (error) {
    logger.error('Create system announcement error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error creating system announcement',
      error: error.message
    });
  }
};

/**
 * Get system announcements
 */
const getSystemAnnouncements = async (req, res) => {
  try {
    const { limit = 10, page = 1 } = req.query;
    const userRole = req.user.role;

    // Build query
    const query = {
      isActive: true,
      $or: [
        { targetRoles: { $size: 0 } }, // No specific roles (all users)
        { targetRoles: userRole } // Specific role match
      ]
    };

    // Add expiry filter
    const now = new Date();
    query.$or = query.$or.map(condition => ({
      ...condition,
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: null },
        { expiresAt: { $gt: now } }
      ]
    }));

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const announcements = await SystemAnnouncement.find(query)
      .populate('createdBy', 'name')
      .sort({ priority: -1, createdAt: -1 }) // High priority first, then newest
      .skip(skip)
      .limit(parseInt(limit))
      .select('title message priority targetRoles expiresAt createdAt createdBy');

    const total = await SystemAnnouncement.countDocuments(query);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: {
        announcements: announcements.map(ann => ({
          id: ann._id,
          title: ann.title,
          message: ann.message,
          priority: ann.priority,
          targetRoles: ann.targetRoles,
          expiresAt: ann.expiresAt,
          createdAt: ann.createdAt,
          createdBy: ann.createdBy?.name || 'System'
        })),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });
  } catch (error) {
    logger.error('Get system announcements error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error fetching system announcements',
      error: error.message
    });
  }
};

module.exports = {
  getSystemMetrics,
  getSystemHealth,
  getBackupStatus,
  getMaintenanceMode,
  toggleMaintenanceMode,
  createSystemAnnouncement,
  getSystemAnnouncements
};
