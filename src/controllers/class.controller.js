import Class from '../models/Class.js';
import School from '../models/School.js';
import Session from '../models/Session.js';
import { HTTP_STATUS } from '../config/constants.js';
import { logger } from '../utils/logger.js';
import { createAuditLog } from '../utils/auditLogger.js';

// Create Class
export const createClass = async (req, res) => {
  try {
    const { name, schoolId, sessionId } = req.body;

    // Validate required fields
    if (!name || !schoolId || !sessionId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Class name, schoolId, and sessionId are required'
      });
    }

    // Verify school exists
    const school = await School.findById(schoolId);
    if (!school) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'School not found'
      });
    }

    // Verify session exists and belongs to school
    const session = await Session.findOne({ _id: sessionId, schoolId });
    if (!session) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Session not found or does not belong to the specified school'
      });
    }

    // Check if class already exists for this school and session
    const existingClass = await Class.findOne({ name, schoolId, sessionId });
    if (existingClass) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: `Class '${name}' already exists for this school and session`
      });
    }

    // Create class
    const newClass = await Class.create({
      name,
      schoolId,
      sessionId,
      status: 'active'
    });

    // Audit log
    await createAuditLog({
      action: 'CLASS_CREATED',
      performedBy: req.user.userId,
      resourceType: 'Class',
      resourceId: newClass._id,
      schoolId,
      details: { className: name, sessionId }
    });

    logger.success(`Class created: ${name} for school ${schoolId}`);

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: 'Class created successfully',
      data: newClass
    });
  } catch (error) {
    logger.error('Create class error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error creating class',
      error: error.message
    });
  }
};

// Get All Classes (with optional school and session filters)
export const getAllClasses = async (req, res) => {
  try {
    const { schoolId, sessionId } = req.query;

    // Build filter
    const filter = {};
    if (schoolId) filter.schoolId = schoolId;
    if (sessionId) filter.sessionId = sessionId;

    const classes = await Class.find(filter)
      .populate('schoolId', 'name code')
      .populate('sessionId', 'name startDate endDate')
      .sort({ name: 1 });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      count: classes.length,
      data: classes
    });
  } catch (error) {
    logger.error('Get classes error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error retrieving classes',
      error: error.message
    });
  }
};

// Get Class by ID
export const getClassById = async (req, res) => {
  try {
    const { id } = req.params;

    const classData = await Class.findById(id)
      .populate('schoolId', 'name code')
      .populate('sessionId', 'name startDate endDate');

    if (!classData) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Class not found'
      });
    }

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: classData
    });
  } catch (error) {
    logger.error('Get class error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error retrieving class',
      error: error.message
    });
  }
};
