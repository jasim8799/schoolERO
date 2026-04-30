const mongoose = require('mongoose');
const Class = require('../models/Class.js');
const School = require('../models/School.js');
const AcademicSession = require('../models/AcademicSession.js');
const { HTTP_STATUS } = require('../config/constants.js');
const { logger } = require('../utils/logger.js');
const { auditLog } = require('../utils/auditLog.js');

const handleControllerError = (res, error, { context = 'Request', duplicateMessage } = {}) => {
  if (error.code === 11000) {
    const field = Object.keys(error.keyValue || {})[0] || 'value';
    return res.status(HTTP_STATUS.CONFLICT).json({
      success: false,
      message: duplicateMessage || `A ${field} with this name already exists`
    });
  }
  if (error.name === 'CastError') {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      message: `Invalid ID format for field: ${error.path}`
    });
  }
  if (error.name === 'ValidationError') {
    const messages = Object.values(error.errors || {})
      .map((e) => e.message)
      .join(', ');
    return res.status(HTTP_STATUS.UNPROCESSABLE_ENTITY).json({
      success: false,
      message: `Validation failed: ${messages}`
    });
  }

  logger.error(`${context} error:`, error.message);
  return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
    success: false,
    message: 'Internal server error. Please try again later.',
    error: error.message
  });
};

// Create Class
const createClass = async (req, res) => {
  try {
    const { name, order } = req.body;

    // Use schoolId and sessionId from middleware (verified, correct types)
    const schoolId = req.user.schoolId;
    const sessionId = req.user.sessionId;

    if (!name || !name.trim()) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Name is required and cannot be empty'
      });
    }

    if (!schoolId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'School context missing from token'
      });
    }

    if (!sessionId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'No active academic session. Please activate a session first.'
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

    // Check if class already exists for this school and session
    const normalizedName = name.trim();
    const existingClass = await Class.findOne({ name: normalizedName, schoolId, sessionId });
    if (existingClass) {
      return res.status(HTTP_STATUS.CONFLICT).json({
        success: false,
        message: `Class '${normalizedName}' already exists for this school and session`
      });
    }

    // Create class
    const newClass = await Class.create({
      name: normalizedName,
      schoolId,
      sessionId,
      order,
      status: 'active'
    });

    // Audit log — wrapped in try/catch so it NEVER kills the response
    try {
      await auditLog({
        action: 'CLASS_CREATED',
        userId: req.user.userId,
        schoolId,
        details: { className: name, sessionId, classId: newClass._id }
      });
    } catch (auditError) {
      logger.error('Audit log failed for CLASS_CREATED:', auditError.message);
      // Continue — don't fail the request because of audit log
    }

    logger.success(`Class created: ${normalizedName} for school ${schoolId}`);

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: 'Class created successfully',
      data: newClass
    });
  } catch (error) {
    return handleControllerError(res, error, {
      context: 'Create class',
      duplicateMessage: 'A class with this name already exists'
    });
  }
};

// Get All Classes (with optional school and session filters)
const getAllClasses = async (req, res) => {
  try {
    const { sessionId: querySessionId } = req.query;

    const schoolId = req.query.schoolId || req.schoolId || req.user?.schoolId;
    const sessionId =
      querySessionId || req.activeSession?._id || req.user?.sessionId;

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
    return handleControllerError(res, error, { context: 'Get classes' });
  }
};

// Get Class by ID
const getClassById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Invalid class ID format'
      });
    }

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
    return handleControllerError(res, error, { context: 'Get class by ID' });
  }
};

// Update Class
const updateClass = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, order } = req.body;
    const schoolId = req.user.schoolId;
    const sessionId = req.user.sessionId;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Invalid class ID format'
      });
    }

    if (!name || !name.trim()) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Name is required and cannot be empty'
      });
    }

    const normalizedName = name.trim();

    // Check duplicate name (exclude self)
    const duplicate = await Class.findOne({
      name: normalizedName,
      schoolId,
      sessionId,
      _id: { $ne: id }
    });
    if (duplicate) {
      return res.status(HTTP_STATUS.CONFLICT).json({
        success: false,
        message: `Class '${normalizedName}' already exists for this school and session`
      });
    }

    const updated = await Class.findOneAndUpdate(
      { _id: id, schoolId, sessionId },
      { $set: { name: normalizedName, ...(order !== undefined && { order }) } },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Class not found'
      });
    }

    logger.success(`Class updated: ${normalizedName}`);
    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Class updated successfully',
      data: updated
    });
  } catch (error) {
    return handleControllerError(res, error, {
      context: 'Update class',
      duplicateMessage: 'A class with this name already exists'
    });
  }
};

// Delete Class (hard delete — warn: cascades to sections/subjects)
const deleteClass = async (req, res) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.schoolId;
    const sessionId = req.user.sessionId;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Invalid class ID format'
      });
    }

    const deleted = await Class.findOneAndDelete({
      _id: id,
      schoolId,
      sessionId
    });

    if (!deleted) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Class not found'
      });
    }

    // Also delete related sections and subjects
    const Section = require('../models/Section.js');
    const Subject = require('../models/Subject.js');
    await Section.deleteMany({ classId: id, schoolId, sessionId });
    await Subject.deleteMany({ classId: id, schoolId, sessionId });

    logger.success(`Class deleted: ${deleted.name}`);
    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Class and its sections/subjects deleted successfully'
    });
  } catch (error) {
    return handleControllerError(res, error, { context: 'Delete class' });
  }
};

module.exports = {
  createClass,
  getAllClasses,
  getClassById,
  updateClass,
  deleteClass
};
