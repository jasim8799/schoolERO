const Class = require('../models/Class.js');
const School = require('../models/School.js');
const AcademicSession = require('../models/AcademicSession.js');
const { HTTP_STATUS } = require('../config/constants.js');
const { logger } = require('../utils/logger.js');
const { auditLog } = require('../utils/auditLog.js');

// Create Class
const createClass = async (req, res) => {
  try {
    const { name, schoolId, order } = req.body;

    // Use sessionId from middleware (already verified active session)
    // req.user.sessionId is set by attachActiveSession middleware
    // This is a real MongoDB ObjectId — no CastError possible
    const sessionId = req.user.sessionId;

    // Validate required fields
    if (!name || !schoolId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Class name and schoolId are required'
      });
    }

    if (!sessionId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'No active academic session found. Please activate a session first.'
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

    // Session already verified by attachActiveSession middleware

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
      order,
      status: 'active'
    });

    // Audit log
    await auditLog({
      action: 'CLASS_CREATED',
      userId: req.user.userId,
      schoolId,
      details: { className: name, sessionId, classId: newClass._id }
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
const getAllClasses = async (req, res) => {
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
const getClassById = async (req, res) => {
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

module.exports = {
  createClass,
  getAllClasses,
  getClassById
};
