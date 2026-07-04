const mongoose = require('mongoose');
const AcademicSession = require('../models/AcademicSession.js');
const School = require('../models/School.js');
const Class = require('../models/Class.js');
const Section = require('../models/Section.js');
const Subject = require('../models/Subject.js');
const Student = require('../models/Student.js');
const FeeStructure = require('../models/FeeStructure.js');
const Exam = require('../models/Exam.js');
const TeacherAssignment = require('../models/TeacherAssignment.js');
const AcademicHistory = require('../models/AcademicHistory.js');
const User = require('../models/User.js');
const redis = require('../../config/redis');
const { HTTP_STATUS } = require('../config/constants.js');
const { logger } = require('../utils/logger.js');
const { auditLog } = require('../utils/auditLog.js');

const _asId = (v) => (v?._id || v)?.toString();

const _resolveSchoolIdFromRequest = (req, bodySchoolId = null) => {
  if (req.user?.role === 'SUPER_ADMIN') {
    return bodySchoolId || req.query.schoolId || req.params.schoolId || _asId(req.user?.schoolId);
  }
  return _asId(req.user?.schoolId) || bodySchoolId || req.params.schoolId || req.query.schoolId;
};

const _isSchoolAllowed = (req, sessionSchoolId) => {
  if (req.user?.role === 'SUPER_ADMIN') return true;
  return _asId(req.user?.schoolId) === _asId(sessionSchoolId);
};

const _invalidateSessionCaches = async (schoolId) => {
  try {
    const patterns = [
      `sessions:${schoolId}:*`,
      `school:${schoolId}:session:*`,
      `permissions:${schoolId}:*`,
      `modules:${schoolId}:*`,
      `layout:nav:${schoolId}:*`,
    ];

    for (const p of patterns) {
      const keys = await redis.keys(p);
      if (Array.isArray(keys) && keys.length > 0) {
        await redis.del(keys);
      }
    }
  } catch (_) {
    // Cache invalidation is best-effort.
  }
};

// Create Academic Session
const createSession = async (req, res) => {
  try {
    const {
      schoolId: bodySchoolId,
      name,
      startDate,
      endDate,
      isActive,
      description
    } = req.body;
    const schoolId = _resolveSchoolIdFromRequest(req, bodySchoolId);

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
      description: description || '',
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

// GET /api/sessions
const listSessions = async (req, res) => {
  try {
    const schoolId = _resolveSchoolIdFromRequest(req);
    if (!schoolId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ success: false, message: 'schoolId is required' });
    }

    const sessions = await AcademicSession.find({ schoolId })
      .sort({ startDate: -1 })
      .lean();

    const stats = {
      total: sessions.length,
      active: sessions.filter((s) => s.isActive).length,
      closed: sessions.filter((s) => (s.lifecycleStatus || '').toUpperCase() === 'CLOSED').length,
      upcoming: sessions.filter((s) => !s.isActive && (s.lifecycleStatus || '').toUpperCase() !== 'CLOSED').length,
    };

    return res.status(HTTP_STATUS.OK).json({
      success: true,
      data: sessions,
      stats,
    });
  } catch (error) {
    logger.error('List sessions error:', error.message);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Error fetching sessions', error: error.message });
  }
};

// GET /api/sessions/current
const getCurrentSession = async (req, res) => {
  try {
    const schoolId = _resolveSchoolIdFromRequest(req);
    if (!schoolId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ success: false, message: 'schoolId is required' });
    }

    const [session, school] = await Promise.all([
      AcademicSession.findOne({ schoolId, isActive: true }).lean(),
      School.findById(schoolId).select('activeSessionId currentSessionId sessionVersion forceLogoutOnSessionChange').lean()
    ]);

    return res.status(HTTP_STATUS.OK).json({
      success: true,
      data: {
        session: session || null,
        sessionVersion: school?.sessionVersion || 1,
        forceLogoutOnSessionChange: !!school?.forceLogoutOnSessionChange,
        activeSessionId: school?.activeSessionId || session?._id || null,
        currentSessionId: school?.currentSessionId || session?._id || null,
      }
    });
  } catch (error) {
    logger.error('Get current session error:', error.message);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Error fetching current session', error: error.message });
  }
};

// Get All Sessions for a School
const getSessionsBySchool = async (req, res) => {
  try {
    const { schoolId } = req.params;

    if (req.user?.role !== 'SUPER_ADMIN' && _asId(req.user?.schoolId) !== _asId(schoolId)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'Access denied. Cannot view another school sessions.'
      });
    }

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
    const { isActive, name, startDate, endDate, description, lifecycleStatus } = req.body || {};

    const session = await AcademicSession.findById(id);
    if (!session) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Session not found'
      });
    }

    // Basic school isolation for non-super-admin users.
    if (
      req.user?.role !== 'SUPER_ADMIN' &&
      req.user?.schoolId &&
      session.schoolId?.toString() !== (req.user.schoolId?._id || req.user.schoolId).toString()
    ) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'Access denied. Cannot edit another school session.'
      });
    }

    const hasEditablePayload =
      typeof name === 'string' ||
      typeof description === 'string' ||
      !!startDate ||
      !!endDate;

    if (hasEditablePayload) {
      const lockedForEdit = session.isActive || ['ACTIVE', 'CLOSED'].includes((session.lifecycleStatus || '').toUpperCase());
      if (lockedForEdit) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          message: 'Only non-activated sessions can be edited.'
        });
      }
    }

    // Optional edit support on the same endpoint (no API contract changes).
    if (typeof name === 'string' && name.trim()) {
      const duplicate = await AcademicSession.findOne({
        schoolId: session.schoolId,
        name: name.trim(),
        _id: { $ne: session._id }
      });
      if (duplicate) {
        return res.status(HTTP_STATUS.CONFLICT).json({
          success: false,
          message: 'Academic session with this name already exists'
        });
      }
      session.name = name.trim();
    }

    if (typeof description === 'string') {
      session.description = description.trim();
    }

    if (startDate) session.startDate = new Date(startDate);
    if (endDate) session.endDate = new Date(endDate);
    if (session.startDate && session.endDate && new Date(session.startDate) >= new Date(session.endDate)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'End date must be after start date'
      });
    }

    if (typeof lifecycleStatus === 'string' && lifecycleStatus.trim()) {
      const normalized = lifecycleStatus.trim().toUpperCase();
      const allowedStatuses = ['SETUP', 'ACTIVE', 'EXAM_PHASE', 'RESULT_PHASE', 'CLOSED'];
      if (!allowedStatuses.includes(normalized)) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          message: `Invalid lifecycleStatus. Allowed: ${allowedStatuses.join(', ')}`
        });
      }
      session.lifecycleStatus = normalized;
      if (normalized === 'CLOSED') {
        session.isActive = false;
        session.closedAt = new Date();
      }
    }

    // If activating this session, deactivate others
    if (isActive === true) {
      await AcademicSession.updateMany(
        { schoolId: session.schoolId, _id: { $ne: id } },
        { isActive: false }
      );
      session.lifecycleStatus = 'ACTIVE';
    } else if (isActive === false) {
      session.isActive = false;
    }

    if (isActive === true) {
      session.isActive = true;
    }
    await session.save();

    logger.success(`Session updated: ${session.name}`);

    // Create audit log
    await auditLog({
      action: isActive === true ? 'SESSION_ACTIVATED' : 'SESSION_UPDATED',
      userId: req.user.userId,
      schoolId: session.schoolId,
      details: {
        sessionName: session.name,
        isActive: session.isActive,
        action:
          isActive === true
            ? 'activated'
            : isActive === false
                ? 'deactivated'
                : 'edited',
        lifecycleStatus: session.lifecycleStatus,
        startDate: session.startDate,
        endDate: session.endDate,
      },
      req
    });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message:
        isActive === true
          ? 'Session activated successfully'
          : isActive === false
              ? 'Session deactivated successfully'
              : 'Session updated successfully',
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
    const {
      fromSessionId,
      copyFeeStructures = false,
      copyExamTemplates = false,
      copyTimetableTemplates = false,
    } = req.body;
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

    let feesCreated = 0;
    if (copyFeeStructures) {
      const sourceFeeStructures = await FeeStructure.find({ schoolId, sessionId: fromSessionId });
      for (const fee of sourceFeeStructures) {
        const mappedClassId = classIdMap[fee.classId?.toString()];
        if (!mappedClassId) continue;
        try {
          await FeeStructure.create({
            name: fee.name,
            amount: fee.amount,
            frequency: fee.frequency,
            classId: mappedClassId,
            sessionId: targetSessionId,
            schoolId,
            isOptional: fee.isOptional,
            status: fee.status,
            createdBy: req.user.userId,
          });
          feesCreated += 1;
        } catch (_) {}
      }
    }

    let examsCreated = 0;
    if (copyExamTemplates) {
      const sourceExams = await Exam.find({ schoolId, sessionId: fromSessionId });
      const targetSession = await AcademicSession.findById(targetSessionId).select('startDate endDate').lean();
      for (const exam of sourceExams) {
        const mappedClassId = classIdMap[exam.classId?.toString()];
        if (!mappedClassId || !targetSession?.startDate || !targetSession?.endDate) continue;
        try {
          const start = new Date(targetSession.startDate);
          const end = new Date(start);
          end.setDate(end.getDate() + 7);
          await Exam.create({
            name: exam.name,
            classId: mappedClassId,
            sessionId: targetSessionId,
            startDate: start,
            endDate: end > new Date(targetSession.endDate) ? targetSession.endDate : end,
            resultDate: null,
            status: 'Draft',
            schoolId,
            createdBy: req.user.userId,
          });
          examsCreated += 1;
        } catch (_) {}
      }
    }

    let timetableTemplatesCreated = 0;
    if (copyTimetableTemplates) {
      const sourceAssignments = await TeacherAssignment.find({ schoolId, sessionId: fromSessionId }).lean();
      for (const assignment of sourceAssignments) {
        const mappedClassId = classIdMap[assignment.classId?.toString()];
        const mappedSectionId = sectionIdMap[assignment.sectionId?.toString()];
        const mappedSubjectId = subjectIdMap[assignment.subjectId?.toString()];
        if (!mappedClassId || !mappedSectionId || !mappedSubjectId) continue;
        try {
          await TeacherAssignment.create({
            teacherId: assignment.teacherId,
            classId: mappedClassId,
            sectionId: mappedSectionId,
            subjectId: mappedSubjectId,
            day: assignment.day,
            periodNumber: assignment.periodNumber,
            startTime: assignment.startTime,
            endTime: assignment.endTime,
            schoolId,
            sessionId: targetSessionId,
            isPublished: false,
            weeklyRepeat: assignment.weeklyRepeat || false,
          });
          timetableTemplatesCreated += 1;
        } catch (_) {}
      }
    }

    return res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Session setup complete',
      data: {
        classesCreated: Object.keys(classIdMap).length,
        sectionsCreated: Object.keys(sectionIdMap).length,
        subjectsCreated: Object.keys(subjectIdMap).length,
        feeStructuresCreated: feesCreated,
        examTemplatesCreated: examsCreated,
        timetableTemplatesCreated,
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
    const sessionId = req.params.sessionId || req.params.id;
    const { schoolId, role } = req.user;

    if (role !== 'PRINCIPAL' && role !== 'OPERATOR') {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'Only Principal or Operator can activate sessions'
      });
    }

    const classCount = await Class.countDocuments({ sessionId, schoolId, status: 'active' });
    if (classCount === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Cannot activate: no classes set up for this session. Run session setup first.'
      });
    }

    const targetSession = await AcademicSession.findOne({ _id: sessionId, schoolId });
    if (!targetSession) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Session not found'
      });
    }

    const school = await School.findById(schoolId).select('forceLogoutOnSessionChange');
    const shouldForceLogout = !!school?.forceLogoutOnSessionChange;

    const mongoSession = await mongoose.startSession();
    let previousActive = null;

    try {
      await mongoSession.withTransaction(async () => {
        previousActive = await AcademicSession.findOne({
          schoolId,
          isActive: true,
          _id: { $ne: sessionId }
        }).session(mongoSession);

        await AcademicSession.updateMany(
          { schoolId, _id: { $ne: sessionId } },
          { isActive: false },
          { session: mongoSession }
        );

        targetSession.isActive = true;
        targetSession.lifecycleStatus = 'ACTIVE';
        targetSession.activatedAt = new Date();
        targetSession.activatedBy = req.user.userId;
        await targetSession.save({ session: mongoSession });

        if (previousActive) {
          previousActive.lifecycleStatus = 'CLOSED';
          previousActive.closedAt = new Date();
          previousActive.isActive = false;
          await previousActive.save({ session: mongoSession });
        }

        await School.findByIdAndUpdate(
          schoolId,
          {
            activeSessionId: targetSession._id,
            currentSessionId: targetSession._id,
            $inc: { sessionVersion: 1 },
            ...(shouldForceLogout ? { forceLogoutAt: new Date() } : {})
          },
          { session: mongoSession }
        );
      });
    } finally {
      await mongoSession.endSession();
    }

    await _invalidateSessionCaches(_asId(schoolId));

    // In-app notification for all users in this school.
    const recipients = await User.find(
      {
        schoolId,
        role: { $in: ['PRINCIPAL', 'OPERATOR', 'TEACHER', 'STUDENT', 'PARENT'] },
        status: 'active',
        isDeleted: { $ne: true }
      },
      { _id: 1, role: 1 }
    ).lean();

    if (recipients.length > 0) {
      const NotificationQueue = mongoose.model('NotificationQueue');
      const docs = recipients.map((u) => ({
        schoolId,
        recipientId: u._id,
        recipientRole: u.role,
        type: 'GENERAL',
        title: `Academic Session ${targetSession.name} has started.`,
        body: `New Academic Session Activated ${targetSession.name}. School data has been refreshed.`,
        relatedEntityId: targetSession._id,
        relatedEntityType: 'AcademicSession'
      }));
      await NotificationQueue.insertMany(docs, { ordered: false });
    }

    await auditLog({
      action: 'SESSION_ACTIVATED',
      userId: req.user.userId,
      schoolId,
      details: {
        oldSessionId: previousActive?._id || null,
        newSessionId: targetSession._id,
        newSessionName: targetSession.name,
      },
      req
    });

    return res.status(HTTP_STATUS.OK).json({
      success: true,
      message: shouldForceLogout
        ? `Session "${targetSession.name}" activated. All users must re-login.`
        : `Session "${targetSession.name}" activated. School context refreshed without logout.`,
      data: {
        session: targetSession,
        previousClosedSessionId: previousActive?._id || null,
        forceLogoutOnSessionChange: shouldForceLogout,
      }
    });
  } catch (error) {
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message
    });
  }
};

// POST /api/sessions/:id/close
const closeSession = async (req, res) => {
  try {
    const sessionId = req.params.id || req.params.sessionId;
    const session = await AcademicSession.findById(sessionId);
    if (!session) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ success: false, message: 'Session not found' });
    }
    if (!_isSchoolAllowed(req, session.schoolId)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ success: false, message: 'Access denied' });
    }
    if (session.isActive) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Active session cannot be closed directly. Activate another session first.'
      });
    }

    session.lifecycleStatus = 'CLOSED';
    session.closedAt = new Date();
    session.isActive = false;
    await session.save();

    await auditLog({
      action: 'SESSION_CLOSED',
      userId: req.user.userId,
      schoolId: session.schoolId,
      details: { sessionId: session._id, sessionName: session.name },
      req
    });

    return res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Session closed successfully',
      data: session
    });
  } catch (error) {
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  }
};

// DELETE /api/sessions/:id
const deleteSession = async (req, res) => {
  try {
    const sessionId = req.params.id || req.params.sessionId;
    const session = await AcademicSession.findById(sessionId);
    if (!session) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ success: false, message: 'Session not found' });
    }
    if (!_isSchoolAllowed(req, session.schoolId)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ success: false, message: 'Access denied' });
    }
    if (session.isActive) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ success: false, message: 'Active session cannot be deleted' });
    }

    const schoolId = session.schoolId;

    const checks = await Promise.all([
      Student.countDocuments({ schoolId, sessionId }),
      AcademicHistory.countDocuments({ schoolId, sessionId }),
      mongoose.model('StudentDailyAttendance').countDocuments({ schoolId, sessionId }),
      mongoose.model('StudentSubjectAttendance').countDocuments({ schoolId, sessionId }),
      mongoose.model('TeacherAttendance').countDocuments({ schoolId, sessionId }),
      mongoose.model('StaffAttendance').countDocuments({ schoolId, sessionId }),
      Exam.countDocuments({ schoolId, sessionId }),
      mongoose.model('Result').countDocuments({ schoolId, sessionId }),
      mongoose.model('StudentFee').countDocuments({ schoolId, sessionId }),
      mongoose.model('StudentFeeAssignment').countDocuments({ schoolId, sessionId }),
      mongoose.model('FeePayment').countDocuments({ schoolId, sessionId }),
      mongoose.model('Payment').countDocuments({ schoolId, sessionId }),
      mongoose.model('ExamPayment').countDocuments({ schoolId, sessionId }),
      mongoose.model('Bill').countDocuments({ schoolId, sessionId }),
      mongoose.model('Homework').countDocuments({ schoolId, sessionId }),
      mongoose.model('StudentHostel').countDocuments({ schoolId, sessionId }),
      mongoose.model('TransportFee').countDocuments({ schoolId, sessionId }),
      mongoose.model('StudentTransport').countDocuments({ schoolId, sessionId }),
      TeacherAssignment.countDocuments({ schoolId, sessionId }),
    ]);

    const hasHistoricalRecords = checks.some((count) => count > 0);
    if (hasHistoricalRecords) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Cannot delete. Session contains historical records.'
      });
    }

    await Promise.all([
      FeeStructure.deleteMany({ schoolId, sessionId }),
      Subject.deleteMany({ schoolId, sessionId }),
      Section.deleteMany({ schoolId, sessionId }),
      Class.deleteMany({ schoolId, sessionId }),
      AcademicSession.deleteOne({ _id: sessionId }),
    ]);

    await auditLog({
      action: 'SESSION_DELETED',
      userId: req.user.userId,
      schoolId,
      details: { sessionId, sessionName: session.name },
      req
    });

    return res.status(HTTP_STATUS.OK).json({ success: true, message: 'Session deleted successfully' });
  } catch (error) {
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  }
};

module.exports = {
  createSession,
  listSessions,
  getCurrentSession,
  getSessionsBySchool,
  getActiveSession,
  updateSession,
  duplicateSessionSetup,
  getSessionReadiness,
  activateSession,
  closeSession,
  deleteSession,
};
