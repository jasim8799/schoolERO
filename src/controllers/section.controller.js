const Section = require('../models/Section.js');
const Class = require('../models/Class.js');
const School = require('../models/School.js');
const AcademicSession = require('../models/AcademicSession.js');
const { HTTP_STATUS } = require('../config/constants.js');
const { logger } = require('../utils/logger.js');
const { auditLog } = require('../utils/auditLog.js');

// Create Section
const createSection = async (req, res) => {
  try {
    const { name, classId } = req.body;
    const schoolId = req.user.schoolId._id || req.user.schoolId;
    const sessionId = req.user.sessionId;

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
      schoolId: req.user.schoolId._id || req.user.schoolId,
      sessionId: req.user.sessionId
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
    logger.error('Get section error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error retrieving section',
      error: error.message
    });
  }
};

// Update Section
const updateSection = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const schoolId = req.user.schoolId._id || req.user.schoolId;
    const sessionId = req.user.sessionId;

    if (!name || !name.trim()) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Section name is required'
      });
    }

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
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: `Section '${name}' already exists for this class`
      });
    }

    section.name = name.trim().toUpperCase();
    await section.save();

    logger.success(`Section updated: ${section.name}`);
    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Section updated successfully',
      data: section
    });
  } catch (error) {
    logger.error('Update section error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error updating section',
      error: error.message
    });
  }
};

// Delete Section
const deleteSection = async (req, res) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.schoolId._id || req.user.schoolId;
    const sessionId = req.user.sessionId;

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
    logger.error('Delete section error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error deleting section',
      error: error.message
    });
  }
};

module.exports = {
  createSection,
  getAllSections,
  getSectionById,
  updateSection,
  deleteSection
};
