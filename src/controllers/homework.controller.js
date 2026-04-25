const mongoose = require('mongoose');
const Homework = require('../models/Homework.js');
const Student = require('../models/Student.js');
const AcademicHistory = require('../models/AcademicHistory.js');
const Parent = require('../models/Parent.js');
const Class = require('../models/Class.js');
const Section = require('../models/Section.js');
const Subject = require('../models/Subject.js');
const { HTTP_STATUS, USER_ROLES } = require('../config/constants.js');

const _ip = (req) =>
  req.headers['x-forwarded-for']?.split(',')[0]?.trim()
  || req.socket?.remoteAddress || req.ip || '0.0.0.0';

const _audit = async (action, entityType, entityId, desc, details, req) => {
  try {
    const { auditLog } = require('../utils/auditLog');
    await auditLog({
      action, entityType, entityId,
      userId: req.user?._id,
      schoolId: req.user?.schoolId,
      description: desc,
      details,
      ipAddress: _ip(req),
      role: req.user?.role || 'SYSTEM',
    });
  } catch (_) {}
};

const sessionFilter = (req) => {
  const sid = req.user?.sessionId;
  if (!sid) return {};
  return {
    $or: [
      { sessionId: sid },
      { sessionId: null },
      { sessionId: { $exists: false } },
    ],
  };
};

const applySessionFilter = (req, filter) => {
  const sFilter = sessionFilter(req);
  if (!sFilter.$or) return filter;
  if (!filter.$or) return { ...filter, ...sFilter };

  const userOr = filter.$or;
  const base = { ...filter };
  delete base.$or;
  return {
    ...base,
    $and: [{ $or: userOr }, sFilter],
  };
};

const toObjectId = (value) => {
  if (!value || !mongoose.Types.ObjectId.isValid(value)) return null;
  return new mongoose.Types.ObjectId(value);
};

const buildDueDateFilter = ({ date, fromDate, toDate }) => {
  if (date) {
    const day = new Date(date);
    if (!Number.isNaN(day.getTime())) {
      const start = new Date(day);
      start.setHours(0, 0, 0, 0);
      const end = new Date(day);
      end.setHours(23, 59, 59, 999);
      return { $gte: start, $lte: end };
    }
  }

  const range = {};
  if (fromDate) {
    const from = new Date(fromDate);
    if (!Number.isNaN(from.getTime())) {
      from.setHours(0, 0, 0, 0);
      range.$gte = from;
    }
  }
  if (toDate) {
    const to = new Date(toDate);
    if (!Number.isNaN(to.getTime())) {
      to.setHours(23, 59, 59, 999);
      range.$lte = to;
    }
  }

  return Object.keys(range).length ? range : null;
};

// Create Homework
const createHomework = async (req, res) => {
  try {
    const {
      title,
      description,
      topic,
      chapter,
      classId,
      sectionId,
      subjectId,
      dueDate,
      attachments
    } = req.body;
    const { role, schoolId, sessionId, _id: createdBy } = req.user;

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
      topic,
      chapter,
      classId,
      sectionId,
      subjectId,
      dueDate,
      attachments,
      createdBy,
      sessionId,
      schoolId
    });

    _audit('HOMEWORK_CREATED', 'HOMEWORK', homework._id,
      `Homework "${homework.title}" assigned`, {}, req);
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
    const { classId, sectionId, subjectId, date, fromDate, toDate } = req.query;
    const { schoolId, role, _id: userId } = req.user;

    const schoolObjectId = toObjectId(schoolId);
    if (!schoolObjectId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Invalid schoolId'
      });
    }

    const filter = {
      schoolId: schoolObjectId,
      ...sessionFilter(req)
    };

    if (classId) {
      filter.classId = classId;
    }
    if (sectionId) {
      filter.sectionId = sectionId;
    }
    if (subjectId) {
      filter.subjectId = subjectId;
    }

    // Teacher dashboard fallback: when classId is not provided, show only own homework.
    if (role === USER_ROLES.TEACHER && !classId) {
      filter.createdBy = userId;
    }

    const dueDateFilter = buildDueDateFilter({ date, fromDate, toDate });
    if (dueDateFilter) {
      filter.dueDate = dueDateFilter;
    }

    const homework = await Homework.find(filter)
      .populate('classId', 'name')
      .populate('sectionId', 'name')
      .populate('subjectId', 'name')
      .populate('createdBy', 'name')
      .sort({ dueDate: 1 });

    const groupedByClass = {};
    for (const item of homework) {
      const classKey = item.classId?._id?.toString() || 'unknown';
      if (!groupedByClass[classKey]) {
        groupedByClass[classKey] = {
          classId: item.classId?._id,
          className: item.classId?.name || 'Unknown Class',
          items: []
        };
      }
      groupedByClass[classKey].items.push(item);
    }

    res.status(HTTP_STATUS.OK).json({
      success: true,
      count: homework.length,
      data: homework,
      groupedByClass: Object.values(groupedByClass)
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
    const { role, schoolId, sessionId, isBrowsingHistory } = req.user;
    const resolvedUserId = req.user.userId || req.user._id;

    const schoolObjectId = mongoose.Types.ObjectId.isValid(schoolId) ? new mongoose.Types.ObjectId(schoolId) : null;
    if (!schoolObjectId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Invalid schoolId'
      });
    }

    if (role === USER_ROLES.STUDENT) {
      let classId;
      let sectionId;

      if (isBrowsingHistory) {
        const student = await Student.findOne({
          userId: resolvedUserId,
          schoolId: schoolObjectId,
        }).select('_id classId sectionId');

        if (!student) {
          return res.status(HTTP_STATUS.NOT_FOUND).json({
            success: false,
            message: 'Student not found'
          });
        }

        const historyRecord = await AcademicHistory.findOne({
          studentId: student._id,
          schoolId: schoolObjectId,
          sessionId,
        }).select('classId sectionId');

        if (!historyRecord?.classId) {
          return res.status(HTTP_STATUS.OK).json({
            success: true,
            count: 0,
            data: [],
          });
        }

        classId = historyRecord.classId;
        sectionId = historyRecord.sectionId || null;
      } else {
        const student = await Student.findOne({
          userId: resolvedUserId,
          schoolId: schoolObjectId,
        }).select('classId sectionId');

        if (!student) {
          return res.status(HTTP_STATUS.NOT_FOUND).json({
            success: false,
            message: 'Student profile not found'
          });
        }

        classId = student.classId;
        sectionId = student.sectionId;
      }

      const sectionClauses = [
        { sectionId: null },
        { sectionId: { $exists: false } },
      ];
      if (sectionId) {
        sectionClauses.push({ sectionId });
      }

      // Find homework for the student's class with section filtering
      const homework = await Homework.find(applySessionFilter(req, {
        classId,
        schoolId: schoolObjectId,
        $or: sectionClauses,
      }))
        .populate('classId', 'name')
        .populate('sectionId', 'name')
        .populate('subjectId', 'name')
        .sort({ dueDate: 1 });

      res.status(HTTP_STATUS.OK).json({
        success: true,
        count: homework.length,
        data: homework
      });
    } else if (role === USER_ROLES.PARENT) {
      // Find parent by userId
      const parent = await Parent.findOne({ userId: resolvedUserId, schoolId: schoolObjectId })
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
        const homework = await Homework.find(applySessionFilter(req, {
          classId: child.classId,
          schoolId: schoolObjectId,
          $or: [
            { sectionId: null },
            { sectionId: { $exists: false } },
            { sectionId: child.sectionId }
          ]
        }))
          .populate('classId', 'name')
          .populate('sectionId', 'name')
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
