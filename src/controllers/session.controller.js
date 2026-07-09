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
const { isValidObjectId, isValidDate, validateDateRange, invalidateSessionCachesProduction } = require('../utils/sessionHelpers.js');

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

// Use production-safe SCAN-based cache invalidation instead of KEYS
const _invalidateSessionCaches = async (schoolId) => {
  return invalidateSessionCachesProduction(schoolId);
};

const _activationTimer = () => {
  const startedAt = Date.now();
  const nowIso = () => new Date().toISOString();

  const begin = (step) => {
    const stepStart = Date.now();
    const startIso = nowIso();
    logger.info(`[SESSION_ACTIVATE_TIMING] Step=${step} Start=${startIso}`);
    return {
      finish: (meta = '') => {
        const finishedAt = Date.now();
        const finishIso = nowIso();
        const duration = finishedAt - stepStart;
        const metaPart = meta ? ` Meta=${meta}` : '';
        logger.info(
          `[SESSION_ACTIVATE_TIMING] Step=${step} Finish=${finishIso} DurationMs=${duration}${metaPart}`
        );
      }
    };
  };

  const total = () => {
    logger.info(
      `[SESSION_ACTIVATE_TIMING] Step=TOTAL Finish=${nowIso()} DurationMs=${Date.now() - startedAt}`
    );
  };

  return { begin, total };
};

const _runPostActivationTasks = ({ req, schoolId, targetSession, previousActiveId, previousActiveName }) => {
  setImmediate(async () => {
    const timer = _activationTimer();
    try {
      const tasks = [];

      tasks.push((async () => {
        const cacheStep = timer.begin('BackgroundCacheInvalidation');
        await _invalidateSessionCaches(_asId(schoolId));
        cacheStep.finish(`SchoolId=${_asId(schoolId)}`);
      })());

      tasks.push((async () => {
        const recipientsStep = timer.begin('BackgroundLoadRecipients');
        const recipients = await User.find(
          {
            schoolId,
            role: { $in: ['PRINCIPAL', 'OPERATOR', 'TEACHER', 'STUDENT', 'PARENT'] },
            status: 'active',
            isDeleted: { $ne: true }
          },
          { _id: 1, role: 1 }
        ).lean();
        recipientsStep.finish(`Recipients=${recipients.length}`);

        if (recipients.length > 0) {
          const queueStep = timer.begin('BackgroundQueueNotifications');
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
          queueStep.finish(`Queued=${docs.length}`);
        }
      })());

      tasks.push((async () => {
        const auditQueueStep = timer.begin('BackgroundAuditQueued');
        const auditPayload = {
          action: 'SESSION_ACTIVATED',
          userId: req.user.userId,
          schoolId,
          details: {
            oldSessionId: previousActiveId || null,
            oldSessionName: previousActiveName || null,
            newSessionId: targetSession._id,
            newSessionName: targetSession.name,
          },
          req
        };
        setImmediate(() => {
          const auditExecStep = timer.begin('BackgroundAuditExecute');
          auditLog(auditPayload)
            .then(() => auditExecStep.finish())
            .catch((err) => {
              auditExecStep.finish('Error');
              logger.error(`[SESSION_ACTIVATE_BG_AUDIT] ${err.message}`);
            });
        });
        auditQueueStep.finish();
      })());

      tasks.push((async () => {
        const socketStep = timer.begin('BackgroundSocketBroadcast');
        setImmediate(() => {
          if (global.io?.emit) {
            global.io.emit('session:activated', {
              schoolId: _asId(schoolId),
              sessionId: _asId(targetSession._id),
              sessionName: targetSession.name,
              previousSessionId: previousActiveId ? _asId(previousActiveId) : null,
            });
          }
          socketStep.finish();
        });
      })());

      await Promise.allSettled(tasks);
    } catch (bgError) {
      logger.error(`[SESSION_ACTIVATE_BG] ${bgError.message}`);
    } finally {
      timer.total();
    }
  });
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
    const dateValidation = validateDateRange(startDate, endDate);
    if (!dateValidation.valid) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: dateValidation.message
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

    // If this is the first session (auto-activated), sync School references
    if (!existingActiveSession) {
      await School.findByIdAndUpdate(schoolId, {
        activeSessionId: session._id,
        currentSessionId: session._id,
        $inc: { sessionVersion: 1 },
      });
    }

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

// Update Session (for editing session information ONLY)
// Session activation MUST use POST /sessions/:id/activate endpoint
const updateSession = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive, name, startDate, endDate, description, lifecycleStatus } = req.body || {};

    // FIX 1: Reject activation attempts through this endpoint
    if (isActive !== undefined) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Session activation must use POST /api/sessions/:id/activate endpoint'
      });
    }

    // FIX 3: Validate ObjectId
    if (!isValidObjectId(id)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Invalid session ID format'
      });
    }

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

    // FIX 4: Validate dates before setting
    if (startDate) {
      if (!isValidDate(startDate)) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          message: 'Invalid start date format'
        });
      }
      session.startDate = new Date(startDate);
    }
    if (endDate) {
      if (!isValidDate(endDate)) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          message: 'Invalid end date format'
        });
      }
      session.endDate = new Date(endDate);
    }
    
    if (session.startDate && session.endDate) {
      const dateValidation = validateDateRange(session.startDate, session.endDate);
      if (!dateValidation.valid) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          message: dateValidation.message
        });
      }
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

    // FIX 1: Never activate/deactivate through PATCH/PUT
    // Lifecycle state updates are allowed, but isActive changes only through POST /activate
    await session.save();

    logger.success(`Session updated: ${session.name}`);

    // Create audit log
    await auditLog({
      action: 'SESSION_UPDATED',
      userId: req.user.userId,
      schoolId: session.schoolId,
      details: {
        sessionName: session.name,
        action: 'edited',
        lifecycleStatus: session.lifecycleStatus,
        startDate: session.startDate,
        endDate: session.endDate,
      },
      req
    });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Session updated successfully',
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

    // FIX 3: Validate ObjectIds
    if (!isValidObjectId(targetSessionId)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Invalid target session ID format'
      });
    }
    if (!isValidObjectId(fromSessionId)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Invalid source session ID format'
      });
    }

    // Fetch target session first, derive schoolId from it (supports SUPER_ADMIN)
    const targetSession = await AcademicSession.findById(targetSessionId);
    if (!targetSession) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Target session not found'
      });
    }
    if (!_isSchoolAllowed(req, targetSession.schoolId)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ success: false, message: 'Access denied' });
    }

    const schoolId = targetSession.schoolId;

    const sourceSession = await AcademicSession.findOne({ _id: fromSessionId, schoolId });
    if (!sourceSession) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Source session not found'
      });
    }

    const existingClasses = await Class.countDocuments({ sessionId: targetSessionId, schoolId });
    if (existingClasses > 0) {
      return res.status(409).json({
        success: false,
        message: 'Session already has classes set up. Use reset if needed.',
        existingClasses
      });
    }

    // FIX 2: Wrap entire operation in MongoDB transaction for atomicity
    const mongoSession = await mongoose.startSession();
    let newClasses = [];
    let newSections = [];
    let newSubjects = [];
    let feesCreated = 0;
    let examsCreated = 0;
    let timetableTemplatesCreated = 0;
    let classIdMap = {};
    let sectionIdMap = {};
    let subjectIdMap = {};

    try {
      mongoSession.startTransaction();

      // Batch-fetch all source structure in parallel
      const [sourceClasses, sourceSections, sourceSubjects] = await Promise.all([
        Class.find({ sessionId: fromSessionId, schoolId, status: 'active' }).lean(),
        Section.find({ sessionId: fromSessionId, schoolId, status: 'active' }).lean(),
        Subject.find({ sessionId: fromSessionId, schoolId, status: 'active' }).lean(),
      ]);

      // --- Classes: insertMany ---
      const classInsertDocs = sourceClasses.map((cls) => ({
        name: cls.name,
        order: cls.order,
        schoolId,
        sessionId: targetSessionId,
        status: 'active',
      }));
      if (classInsertDocs.length > 0) {
        newClasses = await Class.insertMany(classInsertDocs, { ordered: true, session: mongoSession });
      }
      sourceClasses.forEach((cls, i) => {
        if (newClasses[i]) classIdMap[cls._id.toString()] = newClasses[i]._id;
      });

      // --- Sections: insertMany with classId mapping ---
      const sectionPairs = [];
      for (const sec of sourceSections) {
        const newClassId = classIdMap[sec.classId?.toString()];
        if (!newClassId) continue;
        sectionPairs.push({
          sourceId: sec._id.toString(),
          doc: {
            name: sec.name,
            classId: newClassId,
            schoolId,
            sessionId: targetSessionId,
            status: sec.status || 'active',
          },
        });
      }
      if (sectionPairs.length > 0) {
        newSections = await Section.insertMany(sectionPairs.map((p) => p.doc), { ordered: true, session: mongoSession });
      }
      sectionPairs.forEach((p, i) => {
        if (newSections[i]) sectionIdMap[p.sourceId] = newSections[i]._id;
      });

      // --- Subjects: insertMany with classId mapping ---
      const subjectPairs = [];
      for (const sub of sourceSubjects) {
        const newClassId = classIdMap[sub.classId?.toString()];
        if (!newClassId) continue;
        subjectPairs.push({
          sourceId: sub._id.toString(),
          doc: {
            name: sub.name,
            classId: newClassId,
            schoolId,
            sessionId: targetSessionId,
            status: sub.status || 'active',
          },
        });
      }
      if (subjectPairs.length > 0) {
        newSubjects = await Subject.insertMany(subjectPairs.map((p) => p.doc), { ordered: true, session: mongoSession });
      }
      subjectPairs.forEach((p, i) => {
        if (newSubjects[i]) subjectIdMap[p.sourceId] = newSubjects[i]._id;
      });

      // --- Optional: Fee Structures ---
      if (copyFeeStructures) {
        try {
          const sourceFees = await FeeStructure.find({ schoolId, sessionId: fromSessionId }).lean();
          const feeDocs = sourceFees
            .filter((fee) => classIdMap[fee.classId?.toString()])
            .map((fee) => ({
              name: fee.name,
              amount: fee.amount,
              frequency: fee.frequency,
              classId: classIdMap[fee.classId.toString()],
              sessionId: targetSessionId,
              schoolId,
              isOptional: fee.isOptional,
              status: fee.status,
              createdBy: req.user.userId,
            }));
          if (feeDocs.length > 0) {
            await FeeStructure.insertMany(feeDocs, { ordered: false, session: mongoSession });
            feesCreated = feeDocs.length;
          }
        } catch (feeError) {
          logger.warn(`[DUPLICATE_SETUP] Fee structure copy failed: ${feeError.message}`);
        }
      }

      // --- Optional: Exam Templates ---
      if (copyExamTemplates) {
        try {
          const sourceExams = await Exam.find({ schoolId, sessionId: fromSessionId }).lean();
          const tStart = new Date(targetSession.startDate);
          const examDocs = sourceExams
            .filter((exam) => classIdMap[exam.classId?.toString()])
            .map((exam) => {
              const start = new Date(tStart);
              const end = new Date(start);
              end.setDate(end.getDate() + 7);
              return {
                name: exam.name,
                classId: classIdMap[exam.classId.toString()],
                sessionId: targetSessionId,
                startDate: start,
                endDate: end > new Date(targetSession.endDate) ? targetSession.endDate : end,
                resultDate: null,
                status: 'Draft',
                schoolId,
                createdBy: req.user.userId,
              };
            });
          if (examDocs.length > 0) {
            await Exam.insertMany(examDocs, { ordered: false, session: mongoSession });
            examsCreated = examDocs.length;
          }
        } catch (examError) {
          logger.warn(`[DUPLICATE_SETUP] Exam template copy failed: ${examError.message}`);
        }
      }

      // --- Optional: Timetable / Teacher Assignments ---
      if (copyTimetableTemplates) {
        try {
          const sourceAssignments = await TeacherAssignment.find({ schoolId, sessionId: fromSessionId }).lean();
          const assignmentDocs = sourceAssignments
            .filter((a) =>
              classIdMap[a.classId?.toString()] &&
              sectionIdMap[a.sectionId?.toString()] &&
              subjectIdMap[a.subjectId?.toString()]
            )
            .map((a) => ({
              teacherId: a.teacherId,
              classId: classIdMap[a.classId.toString()],
              sectionId: sectionIdMap[a.sectionId.toString()],
              subjectId: subjectIdMap[a.subjectId.toString()],
              day: a.day,
              periodNumber: a.periodNumber,
              startTime: a.startTime,
              endTime: a.endTime,
              schoolId,
              sessionId: targetSessionId,
              isPublished: false,
              weeklyRepeat: a.weeklyRepeat || false,
            }));
          if (assignmentDocs.length > 0) {
            await TeacherAssignment.insertMany(assignmentDocs, { ordered: false, session: mongoSession });
            timetableTemplatesCreated = assignmentDocs.length;
          }
        } catch (timetableError) {
          logger.warn(`[DUPLICATE_SETUP] Timetable copy failed: ${timetableError.message}`);
        }
      }

      await mongoSession.commitTransaction();
    } catch (transactionError) {
      await mongoSession.abortTransaction().catch(() => {});
      logger.error(`[DUPLICATE_SETUP] Transaction failed: ${transactionError.message}`);
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: `Session setup failed: ${transactionError.message}. No data was modified.`
      });
    } finally {
      await mongoSession.endSession();
    }

    await auditLog({
      action: 'SESSION_SETUP_DUPLICATED',
      userId: req.user.userId,
      schoolId,
      details: {
        targetSessionId,
        fromSessionId,
        classesCreated: newClasses.length,
        sectionsCreated: newSections.length,
        subjectsCreated: newSubjects.length,
      },
      req,
    });

    return res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Session setup complete',
      data: {
        classesCreated: newClasses.length,
        sectionsCreated: newSections.length,
        subjectsCreated: newSubjects.length,
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
    const schoolId = _resolveSchoolIdFromRequest(req);

    // FIX 3: Validate ObjectId
    if (!isValidObjectId(sessionId)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Invalid session ID format'
      });
    }

    // FIX 6: Extended readiness checks with additional operational requirements
    const [classCount, sectionCount, subjectCount, studentCount, examCount, feeCount,
            teacherAssignmentCount, academicHistoryCount] =
      await Promise.all([
        Class.countDocuments({ sessionId, schoolId, status: 'active' }),
        Section.countDocuments({ sessionId, schoolId, status: 'active' }),
        Subject.countDocuments({ sessionId, schoolId, status: 'active' }),
        Student.countDocuments({ sessionId, schoolId, status: 'ACTIVE' }),
        Exam.countDocuments({ sessionId, schoolId }),
        FeeStructure.countDocuments({ sessionId, schoolId }),
        TeacherAssignment.countDocuments({ sessionId, schoolId }),
        AcademicHistory.countDocuments({ sessionId, schoolId }),
      ]);

    const checks = [
      { key: 'classes',             label: 'Classes created',              passed: classCount   > 0, count: classCount,           required: true  },
      { key: 'sections',            label: 'Sections created',             passed: sectionCount > 0, count: sectionCount,         required: false },
      { key: 'subjects',            label: 'Subjects created',             passed: subjectCount > 0, count: subjectCount,         required: false },
      { key: 'students',            label: 'Students promoted/enrolled',   passed: studentCount > 0, count: studentCount,         required: false },
      { key: 'teacherAssignments',  label: 'Teacher assignments created',  passed: teacherAssignmentCount > 0, count: teacherAssignmentCount, required: false },
      { key: 'exams',               label: 'Exam templates created',       passed: examCount    > 0, count: examCount,            required: false },
      { key: 'fees',                label: 'Fee structures configured',    passed: feeCount     > 0, count: feeCount,            required: false },
      { key: 'academicHistory',     label: 'Academic history migrated',    passed: academicHistoryCount > 0, count: academicHistoryCount, required: false },
    ];

    const canActivate = checks.filter((c) => c.required).every((c) => c.passed);

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
  const timer = _activationTimer();
  try {
    const validationStep = timer.begin('ValidateRoleAndInput');
    const sessionId = req.params.sessionId || req.params.id;
    const { schoolId, role } = req.user;

    if (role !== 'PRINCIPAL' && role !== 'OPERATOR') {
      validationStep.finish('ForbiddenRole');
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'Only Principal or Operator can activate sessions'
      });
    }
    validationStep.finish(`SessionId=${sessionId}`);

    const readinessStep = timer.begin('ValidateSessionReadiness');
    const classCount = await Class.countDocuments({ sessionId, schoolId, status: 'active' });
    if (classCount === 0) {
      readinessStep.finish('Classes=0');
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Cannot activate: no classes set up for this session. Run session setup first.'
      });
    }
    readinessStep.finish(`Classes=${classCount}`);

    // FIX 3: Validate ObjectId
    if (!isValidObjectId(sessionId)) {
      validationStep.finish('InvalidSessionId');
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Invalid session ID format'
      });
    }

    const loadTargetStep = timer.begin('LoadTargetSession');
    const targetSession = await AcademicSession.findOne({ _id: sessionId, schoolId });
    if (!targetSession) {
      loadTargetStep.finish('TargetSessionNotFound');
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Session not found'
      });
    }
    loadTargetStep.finish(`TargetSession=${_asId(targetSession._id)}`);

    const schoolStep = timer.begin('LoadSchoolSessionPolicy');
    const school = await School.findById(schoolId).select('forceLogoutOnSessionChange');
    const shouldForceLogout = !!school?.forceLogoutOnSessionChange;
    schoolStep.finish(`ForceLogoutOnSessionChange=${shouldForceLogout}`);

    const mongoSession = await mongoose.startSession();
    let previousActive = null;

    try {
      const txStart = timer.begin('StartTransaction');
      mongoSession.startTransaction();
      txStart.finish();

      const previousStep = timer.begin('LoadCurrentActiveSession');
      previousActive = await AcademicSession.findOne({
        schoolId,
        isActive: true,
        _id: { $ne: sessionId }
      }).session(mongoSession).lean();
      previousStep.finish(`PreviousActive=${previousActive?._id ? _asId(previousActive._id) : 'none'}`);

      const deactivateStep = timer.begin('DeactivateOtherSessions');
      await AcademicSession.updateMany(
        { schoolId, _id: { $ne: sessionId } },
        { isActive: false },
        { session: mongoSession }
      );
      deactivateStep.finish();

      const activateStep = timer.begin('ActivateTargetSession');
      await AcademicSession.updateOne(
        { _id: targetSession._id, schoolId },
        {
          $set: {
            isActive: true,
            lifecycleStatus: 'ACTIVE',
            activatedAt: new Date(),
            activatedBy: req.user.userId,
          }
        },
        { session: mongoSession }
      );
      activateStep.finish();

      if (previousActive?._id) {
        const closePrevStep = timer.begin('ClosePreviousActiveSession');
        await AcademicSession.updateOne(
          { _id: previousActive._id, schoolId },
          {
            $set: {
              lifecycleStatus: 'CLOSED',
              closedAt: new Date(),
              isActive: false,
            }
          },
          { session: mongoSession }
        );
        closePrevStep.finish(`PreviousClosed=${_asId(previousActive._id)}`);
      }

      const schoolUpdateStep = timer.begin('UpdateSchoolSessionVersion');
      await School.findByIdAndUpdate(
        schoolId,
        {
          activeSessionId: targetSession._id,
          currentSessionId: targetSession._id,
          $inc: { sessionVersion: 1 },
        },
        { session: mongoSession }
      );
      schoolUpdateStep.finish();

      const commitStep = timer.begin('CommitTransaction');
      await mongoSession.commitTransaction();
      commitStep.finish();
    } catch (transactionError) {
      const abortStep = timer.begin('AbortTransaction');
      await mongoSession.abortTransaction().catch(() => {});
      abortStep.finish();
      throw transactionError;
    } finally {
      const endStep = timer.begin('EndTransactionSession');
      await mongoSession.endSession();
      endStep.finish();
    }

    const responseStep = timer.begin('SendHttpResponse');
    const responsePayload = {
      success: true,
      message: 'Academic session activated successfully',
      data: {
        session: {
          ...targetSession.toObject(),
          isActive: true,
          lifecycleStatus: 'ACTIVE',
          activatedBy: req.user.userId,
        },
        previousClosedSessionId: previousActive?._id || null,
        forceLogoutOnSessionChange: shouldForceLogout,
      }
    };
    res.status(HTTP_STATUS.OK).json(responsePayload);
    responseStep.finish();

    _runPostActivationTasks({
      req,
      schoolId,
      targetSession: {
        _id: targetSession._id,
        name: targetSession.name,
      },
      previousActiveId: previousActive?._id || null,
      previousActiveName: previousActive?.name || null,
    });

    timer.total();
    return;
  } catch (error) {
    timer.total();
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
    
    // FIX 3: Validate ObjectId
    if (!isValidObjectId(sessionId)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Invalid session ID format'
      });
    }

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
    
    // FIX 3: Validate ObjectId
    if (!isValidObjectId(sessionId)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Invalid session ID format'
      });
    }

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

// GET /api/sessions/:id/stats
const getSessionStats = async (req, res) => {
  try {
    const sessionId = req.params.id || req.params.sessionId;
    
    // FIX 3: Validate ObjectId
    if (!isValidObjectId(sessionId)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Invalid session ID format'
      });
    }

    const session = await AcademicSession.findById(sessionId).lean();
    if (!session) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ success: false, message: 'Session not found' });
    }
    if (!_isSchoolAllowed(req, session.schoolId)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ success: false, message: 'Access denied' });
    }

    const schoolId = session.schoolId;
    const [
      classes,
      sections,
      students,
      teachers,
      attendanceDaily,
      attendanceSubject,
      feePayments,
      payments,
      results,
      promotedCount,
      retainedCount,
      graduatedCount,
      homeworkCount,
      hostelCount,
      transportCount,
      parentCount,
    ] = await Promise.all([
      Class.countDocuments({ schoolId, sessionId }),
      Section.countDocuments({ schoolId, sessionId }),
      Student.countDocuments({ schoolId, sessionId }),
      TeacherAssignment.countDocuments({ schoolId, sessionId }),
      mongoose.model('StudentDailyAttendance').countDocuments({ schoolId, sessionId }),
      mongoose.model('StudentSubjectAttendance').countDocuments({ schoolId, sessionId }),
      mongoose.model('FeePayment').countDocuments({ schoolId, sessionId }),
      mongoose.model('Payment').countDocuments({ schoolId, sessionId }),
      mongoose.model('Result').countDocuments({ schoolId, sessionId }),
      AcademicHistory.countDocuments({ schoolId, sessionId, status: 'Promoted' }),
      AcademicHistory.countDocuments({ schoolId, sessionId, status: 'Retained' }),
      AcademicHistory.countDocuments({ schoolId, sessionId, status: 'Graduated' }),
      mongoose.model('Homework').countDocuments({ schoolId, sessionId }),
      mongoose.model('StudentHostel').countDocuments({ schoolId, sessionId }),
      mongoose.model('StudentTransport').countDocuments({ schoolId, sessionId }),
      User.countDocuments({ schoolId, role: 'PARENT', status: 'active', isDeleted: { $ne: true } }),
    ]);

    return res.status(HTTP_STATUS.OK).json({
      success: true,
      data: {
        classes,
        sections,
        students,
        teachers,
        attendanceRecords: attendanceDaily + attendanceSubject,
        feeCollections: feePayments + payments,
        results,
        promotionStatus: `Promoted: ${promotedCount}, Retained: ${retainedCount}, Graduated: ${graduatedCount}`,
        homework: homeworkCount,
        hostel: hostelCount,
        transport: transportCount,
        parents: parentCount,
      },
    });
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
  getSessionStats,
};
