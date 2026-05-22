const School = require('../models/School');
const AuditLog = require('../models/AuditLog');

const WEIGHTS = {
  subscriptionValid: 25,
  hasActiveSessions: 15,
  lowAlerts: 20,
  storageOk: 15,
  recentActivity: 15,
  dbResponsive: 10
};

async function calculateSchoolHealthScore(schoolId) {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86400000);

  const school = await School.findById(schoolId)
    .select('subscription limits analytics riskLevel')
    .lean();
  if (!school) return null;

  let score = 0;
  const factors = {};

  const endDate = new Date(school.subscription?.endDate || now);
  const graceEnd = new Date(endDate.getTime() + (school.subscription?.gracePeriodDays || 30) * 86400000);
  const subValid = now < graceEnd;
  factors.subscriptionValid = subValid;
  if (subValid) {
    score += WEIGHTS.subscriptionValid;
  } else {
    score += now < endDate ? WEIGHTS.subscriptionValid : 0;
  }

  const sessionCount = school.analytics?.onlineUsers || 0;
  factors.hasActiveSessions = sessionCount > 0;
  if (sessionCount > 0) score += WEIGHTS.hasActiveSessions;

  const alerts = school.analytics?.alertsCount || 0;
  const alertScore = Math.max(0, WEIGHTS.lowAlerts - alerts * 2);
  factors.alertScore = alertScore;
  score += alertScore;

  const storageUsed = school.analytics?.storageUsedBytes || 0;
  const storageLimit = school.limits?.storageLimit || 1073741824;
  const storagePct = storageLimit > 0 ? storageUsed / storageLimit : 0;
  const storageScore = storagePct < 0.8
    ? WEIGHTS.storageOk
    : storagePct < 0.95
      ? Math.round(WEIGHTS.storageOk * 0.5)
      : 0;
  factors.storagePct = Math.round(storagePct * 100);
  score += storageScore;

  const recentActivity = await AuditLog.countDocuments({
    schoolId,
    createdAt: { $gte: weekAgo }
  }).catch(() => 0);
  factors.recentActivity = recentActivity;
  if (recentActivity > 0) score += WEIGHTS.recentActivity;

  score += WEIGHTS.dbResponsive;
  factors.dbResponsive = true;

  const finalScore = Math.max(0, Math.min(100, score));
  const riskLevel = finalScore >= 80
    ? 'LOW'
    : finalScore >= 60
      ? 'MEDIUM'
      : finalScore >= 40
        ? 'HIGH'
        : 'CRITICAL';

  await School.findByIdAndUpdate(schoolId, {
    $set: {
      healthScore: finalScore,
      riskLevel,
      healthLastChecked: now,
      healthFactors: factors
    }
  }).catch(() => {});

  return { score: finalScore, riskLevel, factors };
}

async function runHealthScanAllSchools() {
  const schools = await School.find({ isDeleted: { $ne: true } })
    .select('_id')
    .lean();

  let updated = 0;
  for (const s of schools) {
    await calculateSchoolHealthScore(s._id).catch(() => {});
    updated += 1;
  }

  console.log(`[HealthEngine] Scanned ${updated} schools`);
}

module.exports = { calculateSchoolHealthScore, runHealthScanAllSchools };
