const School = require('../models/School');

async function predictSchoolRisk(schoolId) {
  const school = await School.findById(schoolId)
    .select('healthScore riskLevel analytics subscription')
    .lean();
  if (!school) return null;

  const now = Date.now();
  const endDate = school.subscription?.endDate ? new Date(school.subscription.endDate).getTime() : now;
  const daysLeft = Math.floor((endDate - now) / 86400000);

  const churnRisk = Math.max(
    0,
    Math.min(
      1,
      0.15 +
        (school.healthScore < 60 ? 0.35 : 0) +
        (daysLeft < 30 ? 0.3 : 0) +
        ((school.analytics?.todayAttendancePct || 0) < 70 ? 0.2 : 0)
    )
  );

  const renewalProb = Math.max(0, Math.min(1, 1 - churnRisk + (daysLeft > 60 ? 0.1 : 0)));

  return {
    schoolId: school._id,
    churnRisk: Number(churnRisk.toFixed(3)),
    renewalProb: Number(renewalProb.toFixed(3)),
    recommendation: churnRisk > 0.7 ? 'Urgent retention workflow' : 'Continue monitoring'
  };
}

module.exports = { predictSchoolRisk };
