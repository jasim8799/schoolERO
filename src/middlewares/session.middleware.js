const AcademicSession = require('../models/AcademicSession');

const attachActiveSession = async (req, res, next) => {
  try {
    // SUPER_ADMIN can pass sessionId manually
    if (req.user?.role === 'SUPER_ADMIN') {
      return next();
    }

    // If sessionId already provided, respect it
    if (req.body.sessionId) {
      return next();
    }

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

    if (!activeSession) {
      return res.status(400).json({
        success: false,
        message: 'No active academic session found for this school'
      });
    }

    // 🔥 AUTO-ATTACH
    req.body.sessionId = activeSession._id;

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
