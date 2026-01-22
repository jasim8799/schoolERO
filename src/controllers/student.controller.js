const Student = require('../models/Student.js');
const Parent = require('../models/Parent.js');
const User = require('../models/User.js');
const Class = require('../models/Class.js');
const Section = require('../models/Section.js');
const AcademicSession = require('../models/AcademicSession.js');
const { HTTP_STATUS } = require('../config/constants.js');
const { logger } = require('../utils/logger.js');
const { auditLog } = require('../utils/auditLog_new.js');

// Create Student
const createStudent = async (req, res) => {
  try {
    const {
      name,
      rollNumber,
      classId,
      sectionId,
      parentId,
      dateOfBirth,
      gender,
      address
    } = req.body;

    const schoolId = req.user.schoolId._id || req.user.schoolId;

    let sessionId = req.user.sessionId;
    if (!sessionId) {
      const activeSession = await AcademicSession.findOne({
        schoolId,
        isActive: true
      });
      if (!activeSession) {
        return res.status(400).json({
          success: false,
          message: 'No active academic session found'
        });
      }
      sessionId = activeSession._id;
    }

    // Validate required fields
    if (!name || !rollNumber || !classId || !sectionId || !parentId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'name, rollNumber, classId, sectionId, and parentId are required'
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

    // Verify section exists and belongs to the class
    const section = await Section.findOne({ _id: sectionId, classId, schoolId, sessionId });
    if (!section) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Section not found or does not belong to the specified class'
      });
    }

    // Verify parent exists and belongs to school
    const parent = await Parent.findOne({ _id: parentId, schoolId })
      .populate('userId', 'mobile');
    if (!parent) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Parent not found or does not belong to the specified school'
      });
    }

    // Check if roll number already exists for this class
    const existingStudent = await Student.findOne({
      rollNumber,
      classId,
      schoolId,
      sessionId
    });
    if (existingStudent) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: `Roll number '${rollNumber}' already exists in this class`
      });
    }

    // Create student
    const newStudent = await Student.create({
      name,
      rollNumber,
      classId,
      sectionId,
      parentId,
      schoolId,
      sessionId,
      status: 'ACTIVE',
      dateOfBirth,
      gender,
      address,
      mobile: parent.userId?.mobile || null
    });

    // Add student to parent's children array
    if (!parent.children.some(id => id.toString() === newStudent._id.toString())) {
      parent.children.push(newStudent._id);
    }
    await parent.save();

    // Audit log
    await auditLog({
      action: 'STUDENT_CREATED',
      userId: req.user.userId,
      schoolId,
      details: {
        studentId: newStudent._id,
        studentName: name,
        rollNumber,
        classId,
        sectionId,
        parentId,
        sessionId
      }
    });

    logger.success(`Student created: ${name} (${rollNumber})`);

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: 'Student created successfully',
      data: newStudent
    });
  } catch (error) {
    logger.error('Create student error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error creating student',
      error: error.message
    });
  }
};

// Get All Students (with filters)
const getAllStudents = async (req, res) => {
  try {
    const { classId, sectionId, schoolId, sessionId, status } = req.query;

    // Build filter
    const filter = {};
    if (classId) filter.classId = classId;
    if (sectionId) filter.sectionId = sectionId;
    if (schoolId) filter.schoolId = schoolId;
    if (sessionId) filter.sessionId = sessionId;
    if (status) filter.status = status;

    const students = await Student.find(filter)
      .populate('classId', 'name')
      .populate('sectionId', 'name')
      .populate('parentId', 'userId')
      .populate({
        path: 'parentId',
        populate: {
          path: 'userId',
          select: 'name email'
        }
      })
      .populate('schoolId', 'name code')
      .populate('sessionId', 'name startDate endDate')
      .sort({ classId: 1, sectionId: 1, rollNumber: 1 });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      count: students.length,
      data: students
    });
  } catch (error) {
    logger.error('Get students error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error retrieving students',
      error: error.message
    });
  }
};

// Get Student by ID
const getStudentById = async (req, res) => {
  try {
    const { id } = req.params;

    const student = await Student.findById(id)
      .populate('classId', 'name')
      .populate('sectionId', 'name')
      .populate({
        path: 'parentId',
        select: 'userId',
        populate: {
          path: 'userId',
          select: 'name email'
        }
      })
      .populate('schoolId', 'name code')
      .populate('sessionId', 'name startDate endDate');

    if (!student) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Student not found'
      });
    }

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: student
    });
  } catch (error) {
    logger.error('Get student error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error retrieving student',
      error: error.message
    });
  }
};

// Update Student Status (NO DELETE - only status change)
const updateStudentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['ACTIVE', 'PROMOTED', 'LEFT'].includes(status)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Valid status (ACTIVE, PROMOTED, LEFT) is required'
      });
    }

    const student = await Student.findById(id);
    if (!student) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Student not found'
      });
    }

    student.status = status;
    await student.save();

    logger.success(`Student status updated: ${student.name} -> ${status}`);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Student status updated successfully',
      data: student
    });
  } catch (error) {
    logger.error('Update student status error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error updating student status',
      error: error.message
    });
  }
};

// Link User to Student
const linkUserToStudent = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'userId is required'
      });
    }

    // Find student
    const student = await Student.findById(id);
    if (!student) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Student not found'
      });
    }

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'User not found'
      });
    }

    // Validate user role
    if (user.role !== 'STUDENT') {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'User must have STUDENT role'
      });
    }

    // Validate school match
    if (user.schoolId.toString() !== student.schoolId.toString()) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'User and student must belong to the same school'
      });
    }

    // Link user to student
    student.userId = userId;
    await student.save();

    // Ensure parent.children is updated
    const parent = await Parent.findById(student.parentId);
    if (parent && !parent.children.some(id => id.toString() === student._id.toString())) {
      parent.children.push(student._id);
      await parent.save();
    }

    // Audit log
    await auditLog({
      action: 'STUDENT_USER_LINKED',
      userId: req.user.userId,
      schoolId: req.user.schoolId,
      details: {
        studentId: student._id,
        studentName: student.name,
        linkedUserId: userId,
        linkedUserName: user.name
      }
    });

    logger.success(`Student linked to user: ${student.name} -> ${user.name}`);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Student linked to user successfully',
      data: student
    });
  } catch (error) {
    logger.error('Link user to student error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error linking user to student',
      error: error.message
    });
  }
};

// Move Student to Active Session
const moveStudentToActiveSession = async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolId, sessionId } = req.user;

    const normalizedSchoolId = schoolId._id || schoolId;

    let activeSessionId = sessionId;
    if (!activeSessionId) {
      const activeSession = await AcademicSession.findOne({
        schoolId: normalizedSchoolId,
        isActive: true
      });
      if (!activeSession) {
        return res.status(400).json({ message: 'No active academic session found' });
      }
      activeSessionId = activeSession._id;
    }

    const student = await Student.findById(id);
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    if (student.schoolId.toString() !== normalizedSchoolId.toString()) {
      return res.status(403).json({ message: 'School mismatch' });
    }

    student.sessionId = activeSessionId;
    await student.save();

    res.json({
      success: true,
      message: 'Student moved to active session successfully',
      data: student
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get logged-in student's own profile
const getMyStudentProfile = async (req, res) => {
  try {
    const student = await Student.findOne({
      userId: req.user.userId
    })
      .populate('classId', 'name')
      .populate('sectionId', 'name')
      .populate('schoolId', 'name code')
      .populate('sessionId', 'name startDate endDate');

    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student profile not found'
      });
    }

    res.json({
      success: true,
      data: student
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
};

module.exports = {
  createStudent,
  getAllStudents,
  getStudentById,
  updateStudentStatus,
  linkUserToStudent,
  moveStudentToActiveSession,
  getMyStudentProfile
};
