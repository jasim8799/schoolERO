const Parent = require('../models/Parent.js');
const User = require('../models/User.js');
const Student = require('../models/Student.js');
const { HTTP_STATUS, USER_ROLES } = require('../config/constants.js');
const { logger } = require('../utils/logger.js');
const { auditLog } = require('../utils/auditLog_new.js');

// Create Parent
const createParent = async (req, res) => {
  try {
    const { userId, whatsappNumber } = req.body;
    const schoolId = req.user.schoolId;

    // Validate required fields
    if (!userId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'userId is required'
      });
    }

    // Verify user exists, is a PARENT, and belongs to the school
    const user = await User.findOne({ _id: userId, role: USER_ROLES.PARENT, schoolId });
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'User not found or is not a PARENT in this school'
      });
    }

    // Update whatsappNumber if provided
    if (whatsappNumber !== undefined) {
      await User.findByIdAndUpdate(userId, { whatsappNumber });
    }

    // Check if parent profile already exists
    const existingParent = await Parent.findOne({ userId });
    if (existingParent) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Parent profile already exists for this user'
      });
    }

    // Create parent (children will be empty initially)
    const newParent = await Parent.create({
      userId,
      children: [],
      schoolId,
      status: 'active'
    });

    // ✅ Backfill existing students linked to this parent
    const students = await Student.find({
      parentId: newParent._id,
      schoolId
    });

    if (students.length) {
      newParent.children = students.map(s => s._id);
      await newParent.save();
    }

    // Audit log
    await auditLog({
      action: 'PARENT_CREATED',
      userId: req.user.userId,
      schoolId,
      details: { parentUserId: userId, parentId: newParent._id }
    });

    logger.success(`Parent profile created for user ${userId} (${user.name})`);

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: 'Parent profile created successfully',
      data: newParent
    });
  } catch (error) {
    logger.error('Create parent error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error creating parent profile',
      error: error.message
    });
  }
};

// Get All Parents
const getAllParents = async (req, res) => {
  try {
    const { schoolId } = req.query;

    // Build filter
    const filter = {};
    if (schoolId) filter.schoolId = schoolId;

    const parents = await Parent.find(filter)
      .populate('userId', 'name email')
      .populate('schoolId', 'name code')
      .populate('children', 'name rollNumber')
      .sort({ createdAt: -1 });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      count: parents.length,
      data: parents
    });
  } catch (error) {
    logger.error('Get parents error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error retrieving parents',
      error: error.message
    });
  }
};

// Get Parent by ID
const getParentById = async (req, res) => {
  try {
    const { id } = req.params;

    const parent = await Parent.findById(id)
      .populate('userId', 'name email')
      .populate('schoolId', 'name code')
      .populate({
        path: 'children',
        select: 'name rollNumber classId sectionId',
        populate: [
          { path: 'classId', select: 'name' },
          { path: 'sectionId', select: 'name' }
        ]
      });

    if (!parent) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Parent not found'
      });
    }

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: parent
    });
  } catch (error) {
    logger.error('Get parent error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error retrieving parent',
      error: error.message
    });
  }
};

// Get Current Parent's Children
const getMyChildren = async (req, res) => {
  try {
    const { userId, schoolId } = req.user;

    const parent = await Parent.findOne({ userId, schoolId })
      .populate({
        path: 'children',
        select: 'name rollNumber classId sectionId',
        populate: [
          { path: 'classId', select: 'name' },
          { path: 'sectionId', select: 'name' }
        ]
      });

    if (!parent) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Parent profile not found'
      });
    }

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: parent.children
    });
  } catch (error) {
    logger.error('Get my children error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error retrieving children',
      error: error.message
    });
  }
};

module.exports = {
  createParent,
  getAllParents,
  getParentById,
  getMyChildren
};
