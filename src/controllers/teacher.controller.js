const Teacher = require('../models/Teacher.js');
const User = require('../models/User.js');
const Class = require('../models/Class.js');
const Subject = require('../models/Subject.js');
const School = require('../models/School.js');
const { HTTP_STATUS, USER_ROLES } = require('../config/constants.js');
const { logger } = require('../utils/logger.js');
const { auditLog } = require('../utils/auditLog.js');

// Create Teacher
const createTeacher = async (req, res) => {
  try {
    const { userId } = req.body;
    const schoolId = req.user.schoolId;
    const sessionId = req.user.sessionId;

    // Validate required fields
    if (!userId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'userId is required'
      });
    }

    // Verify user exists, is a TEACHER, and belongs to the school
    const user = await User.findOne({ _id: userId, role: USER_ROLES.TEACHER, schoolId });
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'User not found or is not a TEACHER in this school'
      });
    }

    // Check if teacher profile already exists
    const existingTeacher = await Teacher.findOne({ userId });
    if (existingTeacher) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Teacher profile already exists for this user'
      });
    }

    // Create teacher
    const newTeacher = await Teacher.create({
      userId,
      schoolId,
      sessionId,
      status: 'active'
    });

    // Audit log
    await auditLog({
      action: 'TEACHER_CREATED',
      userId: req.user.userId,
      schoolId,
      details: { teacherUserId: userId, teacherId: newTeacher._id }
    });

    logger.success(`Teacher profile created for user ${userId}`);

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: 'Teacher profile created successfully',
      data: newTeacher
    });
  } catch (error) {
    logger.error('Create teacher error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error creating teacher profile',
      error: error.message
    });
  }
};

// Get All Teachers
const getAllTeachers = async (req, res) => {
  try {
    const { schoolId } = req.query;

    // Build filter
    const filter = {};
    if (schoolId) filter.schoolId = schoolId;

    const teachers = await Teacher.find(filter)
      .populate('userId', 'name email')
      .populate('schoolId', 'name code')
      .sort({ createdAt: -1 });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      count: teachers.length,
      data: teachers
    });
  } catch (error) {
    logger.error('Get teachers error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error retrieving teachers',
      error: error.message
    });
  }
};

// Get Teacher by ID
const getTeacherById = async (req, res) => {
  try {
    const { id } = req.params;

    const teacher = await Teacher.findById(id)
      .populate('userId', 'name email')
      .populate('schoolId', 'name code');

    if (!teacher) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Teacher not found'
      });
    }

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: teacher
    });
  } catch (error) {
    logger.error('Get teacher error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error retrieving teacher',
      error: error.message
    });
  }
};

// Update Teacher Assignments
const updateTeacherAssignments = async (req, res) => {
  try {
    const { id } = req.params;
    const { assignedClasses, assignedSubjects } = req.body;

    const teacher = await Teacher.findById(id);
    if (!teacher) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Teacher not found'
      });
    }

    // Validate assigned classes (if provided)
    if (assignedClasses) {
      const classes = await Class.find({ _id: { $in: assignedClasses }, schoolId: teacher.schoolId });
      if (classes.length !== assignedClasses.length) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          message: 'One or more assigned classes do not belong to this school'
        });
      }
      teacher.assignedClasses = assignedClasses;
    }

    // Validate assigned subjects (if provided)
    if (assignedSubjects) {
      const subjects = await Subject.find({ _id: { $in: assignedSubjects }, schoolId: teacher.schoolId });
      if (subjects.length !== assignedSubjects.length) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          message: 'One or more assigned subjects do not belong to this school'
        });
      }
      teacher.assignedSubjects = assignedSubjects;
    }

    await teacher.save();

    logger.success(`Teacher assignments updated: ${id}`);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Teacher assignments updated successfully',
      data: teacher
    });
  } catch (error) {
    logger.error('Update teacher error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error updating teacher assignments',
      error: error.message
    });
  }
};

module.exports = {
  createTeacher,
  getAllTeachers,
  getTeacherById,
  updateTeacherAssignments
};
