const School = require('../models/School');
const SchoolHealthSnapshot = require('../models/SchoolHealthSnapshot');
const { calculateSchoolHealth, updateAllSchoolsHealth } = require('../services/healthScoring.service');

const getAllSchoolsHealth = async (req, res) => {
  try {
    const { riskLevel } = req.query;
    const query = { isDeleted: false };
    if (riskLevel && riskLevel !== 'ALL') query.riskLevel = riskLevel;

    const schools = await School.find(query)
      .select('name code healthScore riskLevel healthLastChecked healthFactors analytics')
      .sort({ healthScore: 1 })
      .lean();

    return res.json({ success: true, count: schools.length, data: schools });
  } catch (error) {
    console.error('[getAllSchoolsHealth]', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getSchoolHealth = async (req, res) => {
  try {
    const { id } = req.params;
    const school = await School.findById(id)
      .select('name code healthScore riskLevel healthLastChecked healthFactors analytics subscription')
      .lean();

    if (!school) return res.status(404).json({ success: false, message: 'School not found' });
    return res.json({ success: true, data: school });
  } catch (error) {
    console.error('[getSchoolHealth]', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getSchoolHealthHistory = async (req, res) => {
  try {
    const { id } = req.params;
    const limit = Math.min(365, Math.max(1, parseInt(req.query.limit || '60', 10)));

    const snapshots = await SchoolHealthSnapshot.find({ schoolId: id })
      .sort({ date: -1 })
      .limit(limit)
      .lean();

    return res.json({ success: true, count: snapshots.length, data: snapshots });
  } catch (error) {
    console.error('[getSchoolHealthHistory]', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

const rescanSchoolHealth = async (req, res) => {
  try {
    const { id } = req.params;
    const health = await calculateSchoolHealth(id);
    if (!health) return res.status(404).json({ success: false, message: 'School not found' });

    await School.findByIdAndUpdate(id, {
      $set: {
        healthScore: health.healthScore,
        riskLevel: health.riskLevel,
        healthFactors: health.factors,
        healthLastChecked: new Date()
      }
    });

    const date = new Date();
    date.setHours(0, 0, 0, 0);
    await SchoolHealthSnapshot.findOneAndUpdate(
      { schoolId: id, date },
      { $set: health },
      { upsert: true }
    );

    return res.json({ success: true, data: health });
  } catch (error) {
    console.error('[rescanSchoolHealth]', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getAllSchoolsHealth,
  getSchoolHealth,
  getSchoolHealthHistory,
  rescanSchoolHealth,
  updateAllSchoolsHealth
};
