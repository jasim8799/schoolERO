const mongoose = require('mongoose');
const School = require('../models/School');
const User = require('../models/User');
const SecurityLog = require('../models/SecurityLog');
const SchoolHealthSnapshot = require('../models/SchoolHealthSnapshot');
const StudentDailyAttendance = require('../models/StudentDailyAttendance');
const Payment = require('../models/Payment');

async function calculateSchoolHealth(schoolId) {
  const school = await School.findById(schoolId).lean();
  if (!school) return null;

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86400000);
  const monthAgo = new Date(now.getTime() - 30 * 86400000);

  let score = 100;
  const factors = {};

  const endDate = new Date(school.subscription?.endDate || now);
  const daysLeft = Math.floor((endDate.getTime() - now.getTime()) / 86400000);
  let subscriptionScore = 25;
  if (daysLeft < 0) subscriptionScore = 0;
  else if (daysLeft < 7) subscriptionScore = 5;
  else if (daysLeft < 30) subscriptionScore = 15;
  else if (daysLeft < 90) subscriptionScore = 20;
  factors.subscriptionHealth = subscriptionScore;
  score -= (25 - subscriptionScore);

  const Student = mongoose.model('Student');
  const totalStudents = await Student.countDocuments({ schoolId: school._id });
  const feePayers = await Payment.distinct('studentId', {
    schoolId: school._id,
    paymentDate: { $gte: monthAgo }
  });
  const feeRate = totalStudents > 0 ? feePayers.length / totalStudents : 0;
  const feeScore = Math.round(feeRate * 20);
  factors.feeCollection = feeScore;
  score -= (20 - feeScore);

  const attendanceData = await StudentDailyAttendance.aggregate([
    { $match: { schoolId: school._id, date: { $gte: weekAgo } } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        present: {
          $sum: {
            $cond: [{ $in: ['$status', ['present', 'PRESENT']] }, 1, 0]
          }
        }
      }
    }
  ]);

  const attPct = attendanceData[0]?.total > 0
    ? (attendanceData[0].present / attendanceData[0].total)
    : 0;
  const attScore = Math.round(attPct * 20);
  factors.attendanceHealth = attScore;
  score -= (20 - attScore);

  const storageUsed = school.analytics?.storageUsedBytes || 0;
  const storageLimit = school.limits?.storageLimit || 1073741824;
  const storagePct = storageUsed / storageLimit;
  const storageScore = storagePct > 0.95 ? 0 : storagePct > 0.85 ? 4 : storagePct > 0.70 ? 7 : 10;
  factors.storageHealth = storageScore;
  score -= (10 - storageScore);

  const securityEvents = await SecurityLog.countDocuments({
    schoolId: school._id,
    severity: { $in: ['ERROR', 'CRITICAL'] },
    createdAt: { $gte: weekAgo }
  });
  const secScore = securityEvents > 10 ? 0 : securityEvents > 5 ? 4 : securityEvents > 2 ? 7 : 10;
  factors.securityHealth = secScore;
  score -= (10 - secScore);

  const activeUserCount = await User.countDocuments({
    schoolId: school._id,
    lastLogin: { $gte: weekAgo },
    status: 'active'
  });
  const totalUsers = await User.countDocuments({ schoolId: school._id, status: 'active' });
  const activityRate = totalUsers > 0 ? activeUserCount / totalUsers : 0;
  const actScore = Math.round(activityRate * 10);
  factors.activityHealth = actScore;
  score -= (10 - actScore);

  const enabledModules = Object.values(school.modules || {}).filter(Boolean).length;
  const moduleScore = Math.min(5, Math.floor(enabledModules / 4));
  factors.moduleUsage = moduleScore;
  score -= (5 - moduleScore);

  score = Math.max(0, Math.min(100, score));
  const riskLevel = score >= 80 ? 'LOW' : score >= 60 ? 'MEDIUM' : score >= 40 ? 'HIGH' : 'CRITICAL';

  const aiPrediction = {
    churnRisk: daysLeft < 30 ? 0.85 : feeRate < 0.3 ? 0.6 : 0.15,
    renewalProb: daysLeft > 60 && feeRate > 0.7 ? 0.9 : 0.4,
    recommendation: getAIRecommendation(score, factors)
  };

  return {
    schoolId: school._id,
    healthScore: score,
    riskLevel,
    factors,
    aiPrediction,
    studentsCount: totalStudents,
    teachersCount: school.analytics?.teachersCount || 0,
    attendancePct: Math.round(attPct * 100),
    feeCollection: school.analytics?.todayFeeCollection || 0
  };
}

async function updateAllSchoolsHealth() {
  const schools = await School.find({ isDeleted: false }).select('_id').lean();
  const results = [];

  for (const school of schools) {
    try {
      const health = await calculateSchoolHealth(school._id);
      if (!health) continue;

      await School.findByIdAndUpdate(school._id, {
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
        { schoolId: school._id, date },
        { $set: health },
        { upsert: true }
      );

      results.push(health);
    } catch (error) {
      console.error(`[healthScoring] school=${school._id} error=${error.message}`);
    }
  }

  return results;
}

function getAIRecommendation(score, factors) {
  if (score < 40) return 'CRITICAL: Immediate intervention required. Risk of churn very high.';
  if (factors.subscriptionHealth < 10) return 'Subscription expiring soon. Send renewal reminder.';
  if (factors.feeCollection < 8) return 'Low fee collection rate. Enable payment reminders.';
  if (factors.attendanceHealth < 10) return 'Attendance dropping. Check teacher activity.';
  if (factors.storageHealth < 5) return 'Storage critically high. Upgrade plan or cleanup.';
  return 'School performing well. Continue monitoring.';
}

module.exports = { calculateSchoolHealth, updateAllSchoolsHealth };
