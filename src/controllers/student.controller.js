import Student from '../models/Student.js';
import Parent from '../models/Parent.js';
import Class from '../models/Class.js';
import Section from '../models/Section.js';
import School from '../models/School.js';
import AcademicSession from '../models/AcademicSession.js';
import { HTTP_STATUS } from '../config/constants.js';
import { logger } from '../utils/logger.js';
import { createAuditLog } from '../utils/auditLogger.js';

// Create Student
export const createStudent = async (req, res) => {
  try {
    const { 
      name, 
      rollNumber, 
      classId, 
      sectionId, 
      parentId, 
      schoolId, 
      sessionId,
      dateOfBirth,
      gender,
      address
    } = req.body;

    // Validate required fields
    if (!name || !rollNumber || !classId || !sectionId || !parentId || !schoolId || !sessionId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'name, rollNumber, classId, sectionId, parentId, schoolId, and sessionId are required'
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

    // Verify section exists and belongs to the class
    const section = await Section.findOne({ _id: sectionId, classId, schoolId, sessionId });
    if (!section) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Section not found or does not belong to the specified class'
      });
    }

    // Verify parent exists and belongs to school
    const parent = await Parent.findOne({ _id: parentId, schoolId });
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
      address
    });

    // Add student to parent's children array
    parent.children.push(newStudent._id);
    await parent.save();

    // Audit log
    await createAuditLog({
      action: 'STUDENT_CREATED',
      performedBy: req.user.userId,
      resourceType: 'Student',
      resourceId: newStudent._id,
      schoolId,
      details: { 
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
export const getAllStudents = async (req, res) => {
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
export const getStudentById = async (req, res) => {
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
export const updateStudentStatus = async (req, res) => {
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
