const mongoose = require('mongoose');
const Section = require('../models/Section.js');
const Class = require('../models/Class.js');
const School = require('../models/School.js');
const AcademicSession = require('../models/AcademicSession.js');
const { HTTP_STATUS } = require('../config/constants.js');
const { logger } = require('../utils/logger.js');
const { auditLog } = require('../utils/auditLog.js');

const handleControllerError = (res, error, { context = 'Request', duplicateMessage } = {}) => {
  if (error.code === 11000) {
    return res.status(HTTP_STATUS.CONFLICT).json({
      success: false,
      message: duplicateMessage || 'A value with this name already exists'
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

// Create Section
const createSection = async (req, res) => {
  try {
    const { name, classId } = req.body;
    const schoolId = req.user.schoolId._id || req.user.schoolId;
    const sessionId = req.user.sessionId;

    // Validate required fields
    if (!name || !name.trim()) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Name is required and cannot be empty'
      });
    }
    if (!classId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'classId is required'
      });
    }
    if (!mongoose.Types.ObjectId.isValid(classId)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Invalid classId format'
      });
    }
    if (!schoolId || !sessionId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'User must have schoolId and sessionId'
      });
    }

    const normalizedName = name.trim().toUpperCase();

    // Verify school exists
    const school = await School.findById(schoolId);
    if (!school) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'School not found'
      });
    }

    // Session already verified by attachActiveSession middleware

    // Verify class exists and belongs to same school and session
    const classData = await Class.findOne({ _id: classId, schoolId, sessionId });
    if (!classData) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Class not found or does not belong to the specified school and session'
      });
    }

    // Check if section already exists for this class
    const existingSection = await Section.findOne({ 
      name: normalizedName,
      classId, 
      schoolId, 
      sessionId 
    });
    if (existingSection) {
      return res.status(HTTP_STATUS.CONFLICT).json({
        success: false,
        message: 'Section name already exists for this class'
      });
    }

    // Create section
    const newSection = await Section.create({
      name: normalizedName,
      classId,
      schoolId,
      sessionId,
      status: 'active'
    });

    // Audit log — wrapped in try/catch so it NEVER kills the response
    try {
      await auditLog({
        action: 'SECTION_CREATED',
        userId: req.user.userId,
        schoolId,
        details: { sectionName: name, classId, sessionId, sectionId: newSection._id }
      });
    } catch (auditError) {
      logger.error('Audit log failed for SECTION_CREATED:', auditError.message);
    }

    logger.success(`Section created: ${name} for class ${classId}`);

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: 'Section created successfully',
      data: newSection
    });
  } catch (error) {
    return handleControllerError(res, error, {
      context: 'Create section',
      duplicateMessage: 'Section name already exists for this class'
    });
  }
};

// Get All Sections (with optional filters)
const getAllSections = async (req, res) => {
  try {
    const { classId } = req.query;

    // Build filter
    const filter = {
      schoolId: req.user.schoolId._id || req.user.schoolId,
      sessionId: req.user.sessionId
    };
    if (classId) {
      if (!mongoose.Types.ObjectId.isValid(classId)) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          message: 'Invalid classId format'
        });
      }
      filter.classId = classId;
    }

    const sections = await Section.find(filter)
      .populate('classId', 'name')
      .populate('schoolId', 'name code')
      .populate('sessionId', 'name startDate endDate')
      .sort({ classId: 1, name: 1 });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      count: sections.length,
      data: sections
    });
  } catch (error) {
    return handleControllerError(res, error, { context: 'Get sections' });
  }
};

// Get Section by ID
const getSectionById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Invalid section ID format'
      });
    }

    const section = await Section.findById(id)
      .populate('classId', 'name')
      .populate('schoolId', 'name code')
      .populate('sessionId', 'name startDate endDate');

    if (!section || section.schoolId.toString() !== (req.user.schoolId._id || req.user.schoolId).toString() || section.sessionId.toString() !== req.user.sessionId.toString()) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Section not found'
      });
    }

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: section
    });
  } catch (error) {
    return handleControllerError(res, error, { context: 'Get section by ID' });
  }
};

// Update Section
const updateSection = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const schoolId = req.user.schoolId._id || req.user.schoolId;
    const sessionId = req.user.sessionId;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Invalid section ID format'
      });
    }

    if (!name || !name.trim()) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Name is required and cannot be empty'
      });
    }

    const normalizedName = name.trim().toUpperCase();

    const section = await Section.findOne({ _id: id, schoolId, sessionId });
    if (!section) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Section not found'
      });
    }

    // Check duplicate (exclude self)
    const duplicate = await Section.findOne({
      name: name.trim().toUpperCase(),
      classId: section.classId,
      schoolId,
      sessionId,
      _id: { $ne: id }
    });
    if (duplicate) {
      return res.status(HTTP_STATUS.CONFLICT).json({
        success: false,
        message: 'Section name already exists for this class'
      });
    }

    section.name = normalizedName;
    await section.save();

    logger.success(`Section updated: ${section.name}`);
    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Section updated successfully',
      data: section
    });
  } catch (error) {
    return handleControllerError(res, error, {
      context: 'Update section',
      duplicateMessage: 'Section name already exists for this class'
    });
  }
};

// Delete Section
const deleteSection = async (req, res) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.schoolId._id || req.user.schoolId;
    const sessionId = req.user.sessionId;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Invalid section ID format'
      });
    }

    const deleted = await Section.findOneAndDelete({
      _id: id,
      schoolId,
      sessionId
    });

    if (!deleted) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Section not found'
      });
    }

    logger.success(`Section deleted: ${deleted.name}`);
    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Section deleted successfully'
    });
  } catch (error) {
    return handleControllerError(res, error, { context: 'Delete section' });
  }
};

module.exports = {
  createSection,
  getAllSections,
  getSectionById,
  updateSection,
  deleteSection
};
