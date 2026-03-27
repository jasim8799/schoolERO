const mongoose = require('mongoose');
const AcademicSession = require('../models/AcademicSession');

const attachActiveSession = async (req, res, next) => {
  try {
    const schoolId = req.user?.schoolId;

    if (!schoolId) {
      return res.status(400).json({ message: 'School context missing' });
    }

    // Safely convert to ObjectId — catch BSONError for malformed IDs
    let querySchoolId;
    try {
      querySchoolId = schoolId instanceof mongoose.Types.ObjectId
        ? schoolId
        : new mongoose.Types.ObjectId(schoolId);
    } catch (castError) {
      return res.status(400).json({
        success: false,
        message: 'Invalid school ID format',
        error: castError.message
      });
    }

    const activeSession = await AcademicSession.findOne({
      schoolId: querySchoolId,
      isActive: true
    });

    if (!activeSession) {
      return res.status(400).json({
        success: false,
        message: 'No active academic session found. Please go to Academic Sessions and activate a session, then log out and log back in.'
      });
    }

    // IMPORTANT
    req.activeSession = activeSession;
    req.user.sessionId = activeSession._id;

    next();
  } catch (error) {
    console.error('Session middleware error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to attach academic session',
      error: error.message
    });
  }
};

module.exports = { attachActiveSession };
