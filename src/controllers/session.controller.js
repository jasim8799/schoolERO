import AcademicSession from '../models/AcademicSession.js';
import School from '../models/School.js';
import { HTTP_STATUS } from '../config/constants.js';
import { logger } from '../utils/logger.js';
import { createAuditLog } from '../utils/auditLog.js';

// Create Academic Session
export const createSession = async (req, res) => {
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

    // Validate dates
    if (new Date(startDate) >= new Date(endDate)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'End date must be after start date'
      });
    }

    // Create session
    const session = await AcademicSession.create({
      schoolId,
      name,
      startDate,
      endDate,
      isActive: isActive || false
    });

    logger.success(`Academic session created: ${session.name} for school ${school.code}`);

    // Create audit log
    await createAuditLog({
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
export const getSessionsBySchool = async (req, res) => {
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
export const getActiveSession = async (req, res) => {
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
export const updateSession = async (req, res) => {
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
    await createAuditLog({
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
