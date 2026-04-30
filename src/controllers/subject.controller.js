const mongoose = require('mongoose');
const Subject = require('../models/Subject.js');
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

// Create Subject
const createSubject = async (req, res) => {
  try {
    const { name, classId } = req.body;
    const schoolId = req.user.schoolId;
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

    const normalizedName = name.trim();

    // Verify class exists and belongs to same school and session
    const classData = await Class.findOne({ _id: classId, schoolId, sessionId });
    if (!classData) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Class not found or does not belong to the specified school and session'
      });
    }

    // Check if subject already exists for this class
    const existingSubject = await Subject.findOne({ name: normalizedName, classId, schoolId, sessionId });
    if (existingSubject) {
      return res.status(HTTP_STATUS.CONFLICT).json({
        success: false,
        message: 'Subject name already exists for this class'
      });
    }

    // Create subject
    const newSubject = await Subject.create({
      name: normalizedName,
      classId,
      schoolId,
      sessionId,
      status: 'active'
    });

    // Audit log — wrapped in try/catch so it NEVER kills the response
    try {
      await auditLog({
        action: 'SUBJECT_CREATED',
        userId: req.user.userId,
        schoolId,
        details: { subjectName: name, classId, sessionId, subjectId: newSubject._id }
      });
    } catch (auditError) {
      logger.error('Audit log failed for SUBJECT_CREATED:', auditError.message);
    }

    logger.success(`Subject created: ${name} for class ${classId}`);

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: 'Subject created successfully',
      data: newSubject
    });
  } catch (error) {
    return handleControllerError(res, error, {
      context: 'Create subject',
      duplicateMessage: 'Subject name already exists for this class'
    });
  }
};

// Get All Subjects (with optional filters)
const getAllSubjects = async (req, res) => {
  try {
    const { classId, sessionId: querySessionId } = req.query;

    const schoolId = req.query.schoolId || req.schoolId || req.user?.schoolId;
    const sessionId =
      querySessionId || req.activeSession?._id || req.user?.sessionId;

    // Build filter
    const filter = {};
    if (schoolId) filter.schoolId = schoolId;
    if (sessionId) filter.sessionId = sessionId;
    if (classId) {
      if (!mongoose.Types.ObjectId.isValid(classId)) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          message: 'Invalid classId format'
        });
      }
      filter.classId = classId;
    }

    const subjects = await Subject.find(filter)
      .populate('classId', 'name')
      .populate('schoolId', 'name code')
      .populate('sessionId', 'name startDate endDate')
      .sort({ classId: 1, name: 1 });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      count: subjects.length,
      data: subjects
    });
  } catch (error) {
    return handleControllerError(res, error, { context: 'Get subjects' });
  }
};

// Get Subject by ID
const getSubjectById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Invalid subject ID format'
      });
    }

    const subject = await Subject.findOne({ _id: id, schoolId: req.user.schoolId, sessionId: req.user.sessionId })
      .populate('classId', 'name')
      .populate('schoolId', 'name code')
      .populate('sessionId', 'name startDate endDate');

    if (!subject) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Subject not found'
      });
    }

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: subject
    });
  } catch (error) {
    return handleControllerError(res, error, { context: 'Get subject by ID' });
  }
};

// Update Subject
const updateSubject = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const schoolId = req.user.schoolId;
    const sessionId = req.user.sessionId;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Invalid subject ID format'
      });
    }

    if (!name || !name.trim()) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Name is required and cannot be empty'
      });
    }

    const normalizedName = name.trim();

    const subject = await Subject.findOne({ _id: id, schoolId, sessionId });
    if (!subject) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Subject not found'
      });
    }

    // Check duplicate (exclude self)
    const duplicate = await Subject.findOne({
      name: normalizedName,
      classId: subject.classId,
      schoolId,
      sessionId,
      _id: { $ne: id }
    });
    if (duplicate) {
      return res.status(HTTP_STATUS.CONFLICT).json({
        success: false,
        message: 'Subject name already exists for this class'
      });
    }

    subject.name = normalizedName;
    await subject.save();

    logger.success(`Subject updated: ${subject.name}`);
    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Subject updated successfully',
      data: subject
    });
  } catch (error) {
    return handleControllerError(res, error, {
      context: 'Update subject',
      duplicateMessage: 'Subject name already exists for this class'
    });
  }
};

// Delete Subject
const deleteSubject = async (req, res) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.schoolId;
    const sessionId = req.user.sessionId;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Invalid subject ID format'
      });
    }

    const deleted = await Subject.findOneAndDelete({
      _id: id,
      schoolId,
      sessionId
    });

    if (!deleted) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Subject not found'
      });
    }

    logger.success(`Subject deleted: ${deleted.name}`);
    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Subject deleted successfully'
    });
  } catch (error) {
    return handleControllerError(res, error, { context: 'Delete subject' });
  }
};

module.exports = {
  createSubject,
  getAllSubjects,
  getSubjectById,
  updateSubject,
  deleteSubject
};
