const AcademicSession = require('../models/AcademicSession.js');
const School = require('../models/School.js');
const Class = require('../models/Class.js');
const Section = require('../models/Section.js');
const Subject = require('../models/Subject.js');
const Student = require('../models/Student.js');
const { HTTP_STATUS } = require('../config/constants.js');
const { logger } = require('../utils/logger.js');
const { auditLog } = require('../utils/auditLog.js');

// Create Academic Session
const createSession = async (req, res) => {
  try {
    const { schoolId, name, startDate, endDate, isActive } = req.body;

    // Validate required fields
    if (!schoolId || !name || !startDate || !endDate) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'School ID, name, start date, and end date are required'
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

    // Check for existing active session
    const existingActiveSession = await AcademicSession.findOne({
      schoolId,
      isActive: true
    });

    // Validate dates
    if (new Date(startDate) >= new Date(endDate)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'End date must be after start date'
      });
    }

    // Check for existing session with same name
    const existingSession = await AcademicSession.findOne({
      schoolId,
      name
    });

    if (existingSession) {
      return res.status(409).json({
        success: false,
        message: 'Academic session with this name already exists'
      });
    }

    // Create session
    const session = await AcademicSession.create({
      schoolId,
      name,
      startDate,
      endDate,
      isActive: existingActiveSession ? false : true
    });

    logger.success(`Academic session created: ${session.name} for school ${school.code}`);

    // Create audit log
    await auditLog({
      action: 'SESSION_CREATED',
      userId: req.user.userId,
      schoolId: schoolId,
      details: { sessionName: session.name, startDate, endDate },
      req
    });

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: 'Academic session created successfully',
      data: session
    });
  } catch (error) {
    logger.error('Create session error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error creating academic session',
      error: error.message
    });
  }
};

// Get All Sessions for a School
const getSessionsBySchool = async (req, res) => {
  try {
    const { schoolId } = req.params;

    const sessions = await AcademicSession.find({ schoolId })
      .populate('schoolId', 'name code')
      .sort({ startDate: -1 });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      count: sessions.length,
      data: sessions
    });
  } catch (error) {
    logger.error('Get sessions error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error fetching sessions',
      error: error.message
    });
  }
};

// Get Active Session for a School
const getActiveSession = async (req, res) => {
  try {
    const { schoolId } = req.params;

    const session = await AcademicSession.findOne({
      schoolId,
      isActive: true
    }).populate('schoolId', 'name code');

    if (!session) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'No active session found for this school'
      });
    }

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: session
    });
  } catch (error) {
    logger.error('Get active session error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error fetching active session',
      error: error.message
    });
  }
};

// Update Session (to activate/deactivate)
const updateSession = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    const session = await AcademicSession.findById(id);
    if (!session) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Session not found'
      });
    }

    // If activating this session, deactivate others
    if (isActive) {
      await AcademicSession.updateMany(
        { schoolId: session.schoolId, _id: { $ne: id } },
        { isActive: false }
      );
    }

    session.isActive = isActive;
    await session.save();

    logger.success(`Session ${isActive ? 'activated' : 'deactivated'}: ${session.name}`);

    // Create audit log
    await auditLog({
      action: 'SESSION_ACTIVATED',
      userId: req.user.userId,
      schoolId: session.schoolId,
      details: {
        sessionName: session.name,
        isActive,
        action: isActive ? 'activated' : 'deactivated'
      },
      req
    });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: `Session ${isActive ? 'activated' : 'deactivated'} successfully`,
      data: session
    });
  } catch (error) {
    logger.error('Update session error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error updating session',
      error: error.message
    });
  }
};

const duplicateSessionSetup = async (req, res) => {
  try {
    const { sessionId: targetSessionId } = req.params;
    const { fromSessionId } = req.body;
    const { schoolId } = req.user;

    if (!fromSessionId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'fromSessionId is required'
      });
    }

    if (fromSessionId === targetSessionId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Source and target sessions must be different'
      });
    }

    const targetSession = await AcademicSession.findOne({
      _id: targetSessionId,
      schoolId
    });
    if (!targetSession) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Target session not found'
      });
    }

    const sourceSession = await AcademicSession.findOne({
      _id: fromSessionId,
      schoolId
    });
    if (!sourceSession) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Source session not found'
      });
    }

    const existingClasses = await Class.countDocuments({
      sessionId: targetSessionId,
      schoolId
    });
    if (existingClasses > 0) {
      return res.status(409).json({
        success: false,
        message: 'Session already has classes set up. Use reset if needed.',
        existingClasses
      });
    }

    const sourceClasses = await Class.find({
      sessionId: fromSessionId,
      schoolId,
      status: 'active'
    });
    const classIdMap = {};

    for (const cls of sourceClasses) {
      const newClass = await Class.create({
        name: cls.name,
        order: cls.order,
        schoolId,
        sessionId: targetSessionId,
        status: 'active'
      });
      classIdMap[cls._id.toString()] = newClass._id;
    }

    const sourceSections = await Section.find({
      sessionId: fromSessionId,
      schoolId,
      status: 'active'
    });
    const sectionIdMap = {};

    for (const sec of sourceSections) {
      const newClassId = classIdMap[sec.classId?.toString()];
      if (!newClassId) continue;

      const newSection = await Section.create({
        name: sec.name,
        classId: newClassId,
        schoolId,
        sessionId: targetSessionId,
        status: sec.status || 'active'
      });
      sectionIdMap[sec._id.toString()] = newSection._id;
    }

    const sourceSubjects = await Subject.find({
      sessionId: fromSessionId,
      schoolId,
      status: 'active'
    });
    const subjectIdMap = {};

    for (const sub of sourceSubjects) {
      const newClassId = classIdMap[sub.classId?.toString()];
      if (!newClassId) continue;

      const newSubject = await Subject.create({
        name: sub.name,
        classId: newClassId,
        schoolId,
        sessionId: targetSessionId,
        status: sub.status || 'active'
      });
      subjectIdMap[sub._id.toString()] = newSubject._id;
    }

    // Intentionally do not copy fee structures, since yearly amounts may change.
    return res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Session setup complete',
      data: {
        classesCreated: Object.keys(classIdMap).length,
        sectionsCreated: Object.keys(sectionIdMap).length,
        subjectsCreated: Object.keys(subjectIdMap).length,
        classIdMap,
        sectionIdMap
      }
    });
  } catch (error) {
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message
    });
  }
};

const getSessionReadiness = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { schoolId } = req.user;

    const [classCount, sectionCount, subjectCount, studentCount] =
      await Promise.all([
        Class.countDocuments({ sessionId, schoolId, status: 'active' }),
        Section.countDocuments({ sessionId, schoolId, status: 'active' }),
        Subject.countDocuments({ sessionId, schoolId, status: 'active' }),
        Student.countDocuments({ sessionId, schoolId, status: 'ACTIVE' })
      ]);

    const checks = [
      {
        key: 'classes',
        label: 'Classes created',
        passed: classCount > 0,
        count: classCount,
        required: true
      },
      {
        key: 'sections',
        label: 'Sections created',
        passed: sectionCount > 0,
        count: sectionCount,
        required: false
      },
      {
        key: 'subjects',
        label: 'Subjects created',
        passed: subjectCount > 0,
        count: subjectCount,
        required: false
      },
      {
        key: 'students',
        label: 'Students promoted/enrolled',
        passed: studentCount > 0,
        count: studentCount,
        required: false
      }
    ];

    const canActivate = checks
      .filter((c) => c.required)
      .every((c) => c.passed);

    return res.status(HTTP_STATUS.OK).json({
      success: true,
      data: { checks, canActivate, sessionId }
    });
  } catch (error) {
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message
    });
  }
};

const activateSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { schoolId, role } = req.user;

    if (role !== 'PRINCIPAL' && role !== 'OPERATOR') {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'Only Principal or Operator can activate sessions'
      });
    }

    const classCount = await Class.countDocuments({
      sessionId,
      schoolId,
      status: 'active'
    });
    if (classCount === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Cannot activate: no classes set up for this session. Run session setup first.'
      });
    }

    const session = await AcademicSession.findOne({ _id: sessionId, schoolId });
    if (!session) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Session not found'
      });
    }

    await AcademicSession.updateMany(
      { schoolId, _id: { $ne: sessionId } },
      { isActive: false }
    );

    session.isActive = true;
    await session.save();

    await School.findByIdAndUpdate(schoolId, { forceLogoutAt: new Date() });

    return res.status(HTTP_STATUS.OK).json({
      success: true,
      message: `Session "${session.name}" activated. All users must re-login.`,
      data: session
    });
  } catch (error) {
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message
    });
  }
};

module.exports = {
  createSession,
  getSessionsBySchool,
  getActiveSession,
  updateSession,
  duplicateSessionSetup,
  getSessionReadiness,
  activateSession
};
