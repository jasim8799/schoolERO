const AcademicSession = require('../models/AcademicSession');

const attachActiveSession = async (req, res, next) => {
  try {
    const schoolId = req.user?.schoolId;

    if (!schoolId) {
      return res.status(400).json({
        success: false,
        message: 'School context missing'
      });
    }

    const activeSession = await AcademicSession.findOne({
      schoolId,
      isActive: true
    });

    if (activeSession) {
      // Attach sessionId to req
      req.sessionId = activeSession._id;
    }

    next();
  } catch (error) {
    console.error('Attach session error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to attach academic session'
    });
  }
};

module.exports = { attachActiveSession };
