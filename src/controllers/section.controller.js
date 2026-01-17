const Section = require('../models/Section.js');
const Class = require('../models/Class.js');
const School = require('../models/School.js');
const AcademicSession = require('../models/AcademicSession.js');
const { HTTP_STATUS } = require('../config/constants.js');
const { logger } = require('../utils/logger.js');
const { auditLog } = require('../utils/auditLog_new.js');

// Create Section
const createSection = async (req, res) => {
  try {
    const { name, classId } = req.body;
    const schoolId = req.user.schoolId;
    const sessionId = req.sessionId;

    // Validate required fields
    if (!name || !classId || !schoolId || !sessionId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Section name and classId are required, and user must have schoolId and sessionId'
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
    const session = await AcademicSession.findOne({ _id: sessionId, schoolId });
    if (!session) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Session not found or does not belong to the specified school'
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

    // Check if section already exists for this class
    const existingSection = await Section.findOne({ 
      name: name.toUpperCase(), 
      classId, 
      schoolId, 
      sessionId 
    });
    if (existingSection) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: `Section '${name}' already exists for this class`
      });
    }

    // Create section
    const newSection = await Section.create({
      name: name.toUpperCase(),
      classId,
      schoolId,
      sessionId,
      status: 'active'
    });

    // Audit log
    await auditLog({
      action: 'SECTION_CREATED',
      userId: req.user.userId,
      schoolId,
      details: { sectionName: name, classId, sessionId, sectionId: newSection._id }
    });

    logger.success(`Section created: ${name} for class ${classId}`);

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: 'Section created successfully',
      data: newSection
    });
  } catch (error) {
    logger.error('Create section error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error creating section',
      error: error.message
    });
  }
};

// Get All Sections (with optional filters)
const getAllSections = async (req, res) => {
  try {
    const { classId } = req.query;

    // Build filter
    const filter = {
      schoolId: req.user.schoolId,
      sessionId: req.sessionId
    };
    if (classId) filter.classId = classId;

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
    logger.error('Get sections error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error retrieving sections',
      error: error.message
    });
  }
};

// Get Section by ID
const getSectionById = async (req, res) => {
  try {
    const { id } = req.params;

    const section = await Section.findById(id)
      .populate('classId', 'name')
      .populate('schoolId', 'name code')
      .populate('sessionId', 'name startDate endDate');

    if (!section || section.schoolId.toString() !== req.user.schoolId.toString() || section.sessionId.toString() !== req.sessionId.toString()) {
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
    logger.error('Get section error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error retrieving section',
      error: error.message
    });
  }
};

module.exports = {
  createSection,
  getAllSections,
  getSectionById
};
