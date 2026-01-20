const AcademicSession = require('../models/AcademicSession');

const attachActiveSession = async (req, res, next) => {
  try {
    const schoolId = req.user?.schoolId;

    if (!schoolId) {
      return res.status(400).json({ message: 'School context missing' });
    }

    const activeSession = await AcademicSession.findOne({
      schoolId,
      isActive: true
    });

    if (!activeSession) {
      return res.status(400).json({
        message: 'Active academic session not found'
      });
    }

    // IMPORTANT
    req.user.sessionId = activeSession._id;

    next();
  } catch (error) {
    res.status(500).json({ message: 'Failed to attach academic session' });
  }
};

module.exports = { attachActiveSession };
