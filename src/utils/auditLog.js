const AuditLog = require('../models/AuditLog');
const { logger } = require('./logger');
const { buildEnrichedAuditPayload } = require('../middlewares/auditEnrich.middleware');

/**
 * Derive category from action and entityType
 * Auto-categorizes audit events based on action name
 */
function _deriveCategory(action, entityType) {
  const act = (action || '').toUpperCase();
  const ent = (entityType || '').toUpperCase();
  
  // Auth events
  if (/LOGIN|LOGOUT|AUTH|TOKEN|MFA|PASSWORD|LOGIN_FAILED|SESSION/.test(act)) return 'AUTH';
  
  // School events
  if (/SCHOOL/.test(act)) return 'SCHOOL';
  
  // User events
  if (/USER|TEACHER|STUDENT|PARENT|PRINCIPAL|OPERATOR/.test(act)) return 'USER';
  
  // Academic events
  if (/CLASS|SECTION|SUBJECT|EXAM|RESULT|ATTENDANCE|HOMEWORK|ADMISSION|PROMOTION/.test(act)) return 'ACADEMIC';
  
  // Finance events
  if (/FEE|PAYMENT|INVOICE|BILL|SALARY|EXPENSE|REVENUE/.test(act)) return 'FINANCE';
  
  // Subscription events
  if (/SUBSCRIPTION|PLAN|RENEW/.test(act)) return 'SUBSCRIPTION';
  
  // Backup events
  if (/BACKUP|RESTORE/.test(act)) return 'BACKUP';
  
  // Security events
  if (/SECURITY|BREACH|ATTACK|BLOCKED|SUSPICIOUS|FIREWALL|RATE/.test(act)) return 'SECURITY';
  
  // System events
  if (/SYSTEM|MAINTENANCE|ANNOUNCEMENT|NOTICE/.test(act)) return 'SYSTEM';
  
  // Default based on entity type
  if (ent === 'SCHOOL') return 'SCHOOL';
  if (/USER|TEACHER|STUDENT|PARENT/.test(ent)) return 'USER';
  if (/EXAM|result|ATTENDANCE/.test(ent)) return 'ACADEMIC';
  if (/FEE|PAYMENT|BILL/.test(ent)) return 'FINANCE';
  
  return 'SYSTEM';
}

/**
 * Enhanced audit log helper - populates all fields automatically
 * @param {Object} options - Audit log options
 * @param {string} options.action - Action performed (REQUIRED)
 * @param {string} options.userId - User who performed the action
 * @param {string} options.role - User's role
 * @param {string} options.category - Category (auto-derived if not provided)
 * @param {string} options.entityType - Type of entity affected
 * @param {string} options.entityId - ID of entity affected
 * @param {string} options.entityName - Name of entity affected
 * @param {string} options.description - Human-readable description
 * @param {string} options.schoolId - School ID
 * @param {string} options.schoolName - School name (optional)
 * @param {string} options.sessionId - Session ID
 * @param {Object} options.details - Additional details
 * @param {Object} options.req - Express request object
 * @param {string} options.ipAddress - Direct IP address override
 * @param {string} options.severity - Override severity level
 * @param {string} options.userName - User display name (optional, auto-populated)
 */
const auditLog = async (options) => {
  try {
    const {
      action,
      userId,
      role,
      category: providedCategory,
      entityType,
      entityId,
      entityName,
      description,
      schoolId,
      schoolName,
      sessionId,
      details,
      req,
      ipAddress,
      severity
    } = options;

    // Fetch entityName and userName if IDs provided but names not provided
    let resolvedEntityName = entityName;
    let resolvedUserName = details?.userName || details?.createdByName;
    let resolvedSchoolName = schoolName;

    // Fetch entity name if entityId provided but entityName not
    if (entityId && !resolvedEntityName) {
      resolvedEntityName = await _fetchEntityName(entityType, entityId);
    }

    // Fetch user name if userId provided but userName not
    if (userId && !resolvedUserName) {
      resolvedUserName = await _fetchUserName(userId);
    }

    // Fetch school name if schoolId provided but schoolName not
    if (schoolId && !resolvedSchoolName) {
      resolvedSchoolName = await _fetchSchoolName(schoolId);
    }

const _severity = severity || _deriveSeverity(action, details);
    const _category = providedCategory || _deriveCategory(action, entityType);
    
    // Extract userAgent from request headers
    const _userAgent = req?.headers?.['user-agent'] || null;

    const auditData = {
      action,
      category: _category,
      userId: userId || null,
      role: role || 'SYSTEM',
      entityType: entityType || 'SYSTEM',
      entityId: entityId || null,
      entityName: resolvedEntityName || null,
      description: description || action,
      schoolId: schoolId || null,
      schoolName: resolvedSchoolName || null,
      sessionId: sessionId || null,
      ipAddress: ipAddress
        || req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
        || req?.ip
        || req?.connection?.remoteAddress
        || 'SYSTEM',
      userAgent: _userAgent,
      details: {
        ...(details || {}),
        userName: resolvedUserName,
        entityName: resolvedEntityName,
        schoolName: resolvedSchoolName
      },
      severity: _severity
    };

    // DEBUG: Log the payload before saving
    console.log('AUDIT PAYLOAD', JSON.stringify(auditData, null, 2));

    const savedLog = await AuditLog.create(buildEnrichedAuditPayload(auditData, req));
    console.log('AUDIT SAVED', savedLog._id);
    logger.info(`Audit log created: ${action} by ${role} ${resolvedUserName || userId}`);
    global.streamAuditLog?.(savedLog);
    global.streamAuditEvent?.(savedLog);
    return savedLog;
  } catch (error) {
    logger.error('Error creating audit log:', error.message);
    // Don't throw error - audit log failure shouldn't break the main operation
  }
};

/**
 * Fetch entity name based on entityType
 */
async function _fetchEntityName(entityType, entityId) {
  if (!entityType || !entityId) return null;
  
  try {
    const mongoose = require('mongoose');
    const ObjectId = mongoose.Types.ObjectId;
    const id = typeof entityId === 'string' ? new ObjectId(entityId) : entityId;
    
    switch (entityType.toUpperCase()) {
      case 'USER':
      case 'TEACHER':
      case 'STUDENT':
      case 'PARENT':
      case 'PRINCIPAL':
      case 'OPERATOR':
        const User = require('../models/User.js');
        const user = await User.findById(id).select('name').lean();
        return user?.name || null;
        
      case 'SCHOOL':
        const School = require('../models/School.js');
        const school = await School.findById(id).select('name').lean();
        return school?.name || null;
        
      case 'CLASS':
        const Class = require('../models/Class.js');
        const cls = await Class.findById(id).select('name').lean();
        return cls?.name || null;
        
      case 'SECTION':
        const Section = require('../models/Section.js');
        const section = await Section.findById(id).select('name').lean();
        return section?.name || null;
        
      case 'SUBJECT':
        const Subject = require('../models/Subject.js');
        const subject = await Subject.findById(id).select('name').lean();
        return subject?.name || null;
        
      case 'EXAM':
        const Exam = require('../models/Exam.js');
        const exam = await Exam.findById(id).select('name').lean();
        return exam?.name || null;
        
      case 'STUDENT_FEE':
      case 'FEE_STRUCTURE':
        const StudentFee = require('../models/StudentFee.js');
        const studentFee = await StudentFee.findById(id).lean();
        return studentFee?.name || null;
        
      case 'EXPENSE':
        const Expense = require('../models/Expense.js');
        const expense = await Expense.findById(id).select('description').lean();
        return expense?.description || null;
        
      case 'SALARY_PAYMENT':
        const SalaryPayment = require('../models/SalaryPayment.js');
        const salaryPayment = await SalaryPayment.findById(id).lean();
        return salaryPayment?.month || null;
        
      case 'ACADEMIC_SESSION':
        const AcademicSession = require('../models/AcademicSession.js');
        const session = await AcademicSession.findById(id).select('name').lean();
        return session?.name || null;
        
      default:
        return null;
    }
  } catch (error) {
    return null;
  }
}

/**
 * Fetch user name by userId
 */
async function _fetchUserName(userId) {
  if (!userId) return null;
  try {
    const mongoose = require('mongoose');
    const User = require('../models/User.js');
    const id = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    const user = await User.findById(id).select('name').lean();
    return user?.name || null;
  } catch (error) {
    return null;
  }
}

/**
 * Fetch school name by schoolId
 */
async function _fetchSchoolName(schoolId) {
  if (!schoolId) return null;
  try {
    const mongoose = require('mongoose');
    const School = require('../models/School.js');
    const id = typeof schoolId === 'string' ? new mongoose.Types.ObjectId(schoolId) : schoolId;
    const school = await School.findById(id).select('name').lean();
    return school?.name || null;
  } catch (error) {
    return null;
  }
}

/**
 * Derive severity from action and details
 */
function _deriveSeverity(action, details) {
  const act = (action || '').toUpperCase();
  
  // Critical actions
  if (/CRITICAL|BREACH|INJECT|ATTACK|BLOCKED|SUSPICIOUS/.test(act)) return 'CRITICAL';
  
  // Error actions
  if (/FAILED|INVALID|DENIED|UNAUTHORIZED|ERROR|ABUSE|EXPLOIT/.test(act)) return 'ERROR';
  
  // Warning actions
  if (/DELETE|FORCE|OVERRIDE|EXCEEDED|SUSPENDED|DELETED/.test(act)) return 'WARNING';
  
  // Check for custom severity in details
  if (details?.severity && ['INFO', 'WARNING', 'ERROR', 'CRITICAL'].includes(details.severity)) {
    return details.severity;
  }
  
  return 'INFO';
}

/**
 * Record Security Event - specialized for security monitoring
 */
const recordSecurityEvent = async (options) => {
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
    req,
    ipAddress,
    severity = 'WARNING',
    alertType
  } = options;

  return auditLog({
    action,
    userId,
    role: role || 'SYSTEM',
    entityType: entityType || 'SECURITY',
    entityId,
    description,
    schoolId,
    sessionId,
    details: {
      ...(details || {}),
      alertType: alertType || action,
      securityEvent: true
    },
    req,
    ipAddress,
    severity
  });
};

/**
 * Record Audit Log - Alias for auditLog for backward compatibility
 * This is the reusable helper as requested
 */
const recordAuditLog = auditLog;

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
  recordAuditLog,
  recordSecurityEvent,
  getAuditLogs,
  logError
};
