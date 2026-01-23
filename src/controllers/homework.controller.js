const mongoose = require('mongoose');
const Homework = require('../models/Homework.js');
const Student = require('../models/Student.js');
const Parent = require('../models/Parent.js');
const Class = require('../models/Class.js');
const Section = require('../models/Section.js');
const Subject = require('../models/Subject.js');
const { HTTP_STATUS, USER_ROLES } = require('../config/constants.js');

// Create Homework
const createHomework = async (req, res) => {
  try {
    const { title, description, classId, sectionId, subjectId, dueDate, attachments } = req.body;
    const { role, schoolId, sessionId, userId: createdBy } = req.user;

    // Check role permissions
    if (![USER_ROLES.TEACHER, USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR].includes(role)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'Forbidden'
      });
    }

    // Validate required fields
    if (!title || !classId || !subjectId || !dueDate) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'title, classId, subjectId, and dueDate are required'
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

    // Verify subject exists and belongs to the class
    const subject = await Subject.findOne({ _id: subjectId, classId, schoolId, sessionId });
    if (!subject) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Subject not found or does not belong to the specified class'
      });
    }

    // Verify section exists and belongs to the class (if provided)
    if (sectionId) {
      const section = await Section.findOne({ _id: sectionId, classId, schoolId, sessionId });
      if (!section) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          success: false,
          message: 'Section not found or does not belong to the specified class'
        });
      }
    }

    // Create homework
    const homework = await Homework.create({
      title,
      description,
      classId,
      sectionId,
      subjectId,
      dueDate,
      attachments,
      createdBy,
      sessionId,
      schoolId
    });

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: 'Homework created successfully',
      data: homework
    });
  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error creating homework',
      error: error.message
    });
  }
};

// Get Homework by Class
const getHomeworkByClass = async (req, res) => {
  try {
    const { classId } = req.query;
    const { schoolId, sessionId } = req.user;

    if (!classId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'classId is required'
      });
    }

    const homework = await Homework.find({ classId, schoolId: new mongoose.Types.ObjectId(schoolId), sessionId })
      .populate('classId', 'name')
      .populate('subjectId', 'name')
      .sort({ dueDate: 1 });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      count: homework.length,
      data: homework
    });
  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error retrieving homework',
      error: error.message
    });
  }
};

// Get Homework for Student/Parent
const getHomeworkForStudent = async (req, res) => {
  try {
    const { role, userId, schoolId, sessionId } = req.user;

    const schoolObjectId = mongoose.Types.ObjectId.isValid(schoolId) ? new mongoose.Types.ObjectId(schoolId) : null;
    if (!schoolObjectId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Invalid schoolId'
      });
    }

    if (role === USER_ROLES.STUDENT) {
      // Find student by userId
      const student = await Student.findOne({ userId, schoolId: schoolObjectId, sessionId });
      if (!student) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          success: false,
          message: 'Student profile not found'
        });
      }

      // Find homework for the student's class with section filtering
      const homework = await Homework.find({
        classId: student.classId,
        schoolId: schoolObjectId,
        sessionId,
        $or: [
          { sectionId: null },
          { sectionId: { $exists: false } },
          { sectionId: student.sectionId }
        ]
      })
        .populate('classId', 'name')
        .populate('subjectId', 'name')
        .sort({ dueDate: 1 });

      res.status(HTTP_STATUS.OK).json({
        success: true,
        count: homework.length,
        data: homework
      });
    } else if (role === USER_ROLES.PARENT) {
      // Find parent by userId
      const parent = await Parent.findOne({ userId, schoolId: schoolObjectId })
        .populate('children', '_id name classId sectionId');
      if (!parent || !parent.children.length) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          success: false,
          message: 'Parent profile not found or no children assigned'
        });
      }

      // Group homework per child
      const childrenHomework = [];

      for (const child of parent.children) {
        const homework = await Homework.find({
          classId: child.classId,
          schoolId: schoolObjectId,
          sessionId,
          $or: [
            { sectionId: null },
            { sectionId: { $exists: false } },
            { sectionId: child.sectionId }
          ]
        })
          .populate('classId', 'name')
          .populate('subjectId', 'name')
          .sort({ dueDate: 1 });

        childrenHomework.push({
          childId: child._id,
          childName: child.name,
          classId: child.classId,
          sectionId: child.sectionId,
          homework: homework
        });
      }

      res.status(HTTP_STATUS.OK).json({
        success: true,
        data: childrenHomework
      });
    } else {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'Forbidden'
      });
    }
  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error retrieving homework',
      error: error.message
    });
  }
};

module.exports = {
  createHomework,
  getHomeworkByClass,
  getHomeworkForStudent
};
