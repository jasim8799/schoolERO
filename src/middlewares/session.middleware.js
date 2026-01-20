const mongoose = require('mongoose');
const AcademicSession = require('../models/AcademicSession');

const attachActiveSession = async (req, res, next) => {
  try {
    const schoolId = req.user?.schoolId;

    if (!schoolId) {
      return res.status(400).json({ message: 'School context missing' });
    }

    const querySchoolId = schoolId instanceof mongoose.Types.ObjectId ? schoolId : new mongoose.Types.ObjectId(schoolId);

    const activeSession = await AcademicSession.findOne({
      schoolId: querySchoolId,
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
