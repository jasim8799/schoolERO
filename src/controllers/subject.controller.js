const Subject = require('../models/Subject.js');
const Class = require('../models/Class.js');
const School = require('../models/School.js');
const AcademicSession = require('../models/AcademicSession.js');
const { HTTP_STATUS } = require('../config/constants.js');
const { logger } = require('../utils/logger.js');
const { auditLog } = require('../utils/auditLog.js');

// Create Subject
const createSubject = async (req, res) => {
  try {
    const { name, classId } = req.body;
    const schoolId = req.user.schoolId;
    const sessionId = req.user.sessionId;

    // Validate required fields
    if (!name || !classId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Subject name and classId are required'
      });
    }

    // Verify class exists and belongs to same school and session
    const classData = await Class.findOne({ _id: classId, schoolId, sessionId });
    if (!classData) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Class not found or does not belong to the specified school and session'
      });
    }

    // Check if subject already exists for this class
    const existingSubject = await Subject.findOne({ name, classId, schoolId, sessionId });
    if (existingSubject) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: `Subject '${name}' already exists for this class`
      });
    }

    // Create subject
    const newSubject = await Subject.create({
      name,
      classId,
      schoolId,
      sessionId,
      status: 'active'
    });

    // Audit log
    await auditLog({
      action: 'SUBJECT_CREATED',
      userId: req.user.userId,
      schoolId,
      details: { subjectName: name, classId, sessionId, subjectId: newSubject._id }
    });

    logger.success(`Subject created: ${name} for class ${classId}`);

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: 'Subject created successfully',
      data: newSubject
    });
  } catch (error) {
    logger.error('Create subject error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error creating subject',
      error: error.message
    });
  }
};

// Get All Subjects (with optional filters)
const getAllSubjects = async (req, res) => {
  try {
    const { classId } = req.query;

    // Build filter
    const filter = { schoolId: req.user.schoolId, sessionId: req.user.sessionId };
    if (classId) filter.classId = classId;

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
    logger.error('Get subjects error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error retrieving subjects',
      error: error.message
    });
  }
};

// Get Subject by ID
const getSubjectById = async (req, res) => {
  try {
    const { id } = req.params;

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
    logger.error('Get subject error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error retrieving subject',
      error: error.message
    });
  }
};

module.exports = {
  createSubject,
  getAllSubjects,
  getSubjectById
};
