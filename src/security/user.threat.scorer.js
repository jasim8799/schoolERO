const AuditLog = require('../models/AuditLog');
const LoginSession = require('../models/LoginSession');
const SecurityLog = require('../models/SecurityLog');
const UserThreatProfile = require('../models/UserThreatProfile');
const User = require('../models/User');
const redis = require('../config/redis');

const SIGNAL_WEIGHTS = {
  failedLogins: 0.30,
  unusualIpChanges: 0.20,
  multipleDevices: 0.15,
  rapidAttempts: 0.15,
  securityEvents: 0.10,
  vpnUsage: 0.05,
  accountAge: 0.05,
};

async function calculateUserThreatScore(userId, schoolId) {
  const now = new Date();
  const dayAgo = new Date(now - 86400000);
  const weekAgo = new Date(now - 7 * 86400000);

  let totalScore = 0;
  const signals = {};

  try {
    const [failedLogins24h, successLogins24h, uniqueIps, uniqueDevices, securityEvents] = await Promise.all([
      AuditLog.countDocuments({
        userId,
        action: { $in: ['LOGIN_FAILED', 'INVALID_TOKEN', 'BRUTE_FORCE_DETECTED'] },
        createdAt: { $gte: dayAgo },
      }),
      AuditLog.countDocuments({ userId, action: 'LOGIN_SUCCESS', createdAt: { $gte: dayAgo } }),
      LoginSession.distinct('ipAddress', { userId, loginAt: { $gte: weekAgo } }),
      LoginSession.distinct('deviceHash', { userId, loginAt: { $gte: weekAgo } }),
      SecurityLog.countDocuments({
        userId,
        severity: { $in: ['ERROR', 'CRITICAL'] },
        createdAt: { $gte: weekAgo },
      }),
    ]);

    const flScore = failedLogins24h > 10 ? 1.0 : failedLogins24h > 5 ? 0.7 : failedLogins24h > 2 ? 0.4 : failedLogins24h > 0 ? 0.2 : 0;
    signals.failedLogins = { count: failedLogins24h, score: flScore };
    totalScore += flScore * SIGNAL_WEIGHTS.failedLogins;

    const ipScore = uniqueIps.length > 5 ? 1.0 : uniqueIps.length > 3 ? 0.6 : uniqueIps.length > 1 ? 0.2 : 0;
    signals.unusualIpChanges = { count: uniqueIps.length, score: ipScore };
    totalScore += ipScore * SIGNAL_WEIGHTS.unusualIpChanges;

    const devScore = uniqueDevices.length > 4 ? 0.8 : uniqueDevices.length > 2 ? 0.4 : 0;
    signals.multipleDevices = { count: uniqueDevices.length, score: devScore };
    totalScore += devScore * SIGNAL_WEIGHTS.multipleDevices;

    const totalAttempts = failedLogins24h + successLogins24h;
    const rapidScore = totalAttempts > 50 ? 0.8 : totalAttempts > 20 ? 0.4 : 0;
    signals.rapidAttempts = { count: totalAttempts, score: rapidScore };
    totalScore += rapidScore * SIGNAL_WEIGHTS.rapidAttempts;

    const secScore = securityEvents > 5 ? 1.0 : securityEvents > 2 ? 0.5 : securityEvents > 0 ? 0.2 : 0;
    signals.securityEvents = { count: securityEvents, score: secScore };
    totalScore += secScore * SIGNAL_WEIGHTS.securityEvents;

    const vpnLog = await SecurityLog.findOne({ userId, eventType: 'GEO_ANOMALY' }).lean();
    const vpnDetected = !!vpnLog;
    signals.vpnUsage = { detected: vpnDetected, score: vpnDetected ? 0.5 : 0 };
    totalScore += (vpnDetected ? 0.5 : 0) * SIGNAL_WEIGHTS.vpnUsage;

    const user = await User.findById(userId).select('createdAt').lean();
    const accountAgeDays = user?.createdAt ? Math.floor((Date.now() - new Date(user.createdAt).getTime()) / 86400000) : 0;
    const accountAgeScore = accountAgeDays < 7 ? 0.8 : accountAgeDays < 30 ? 0.4 : 0;
    signals.accountAge = { days: accountAgeDays, score: accountAgeScore };
    totalScore += accountAgeScore * SIGNAL_WEIGHTS.accountAge;
  } catch (err) {
    console.error(`[ThreatScorer] User ${userId}:`, err.message);
  }

  const finalScore = Math.min(1.0, parseFloat(totalScore.toFixed(3)));
  const riskLevel = finalScore > 0.65 ? 'HIGH' : finalScore > 0.35 ? 'MEDIUM' : 'LOW';

  return { score: finalScore, riskLevel, signals };
}

async function updateAllUserThreatProfiles() {
  const users = await User.find({ isDeleted: { $ne: true } }).select('_id schoolId').lean();
  let updated = 0;

  for (const user of users) {
    try {
      const { score, riskLevel, signals } = await calculateUserThreatScore(user._id, user.schoolId);

      await UserThreatProfile.findOneAndUpdate(
        { userId: user._id },
        {
          $set: {
            userId: user._id,
            schoolId: user.schoolId,
            threatScore: score,
            riskLevel,
            signals,
            lastCalculatedAt: new Date(),
          },
        },
        { upsert: true },
      );

      await User.findByIdAndUpdate(user._id, {
        $set: {
          threatScore: score,
          riskLevel,
          threatLastChecked: new Date(),
        },
      });

      await redis.setex(`threat:user:${user._id}`, 3600, JSON.stringify({ score, riskLevel })).catch(() => {});
      updated += 1;
    } catch (err) {
      console.error(`[ThreatUpdate] Failed for ${user._id}:`, err.message);
    }
  }

  console.log(`[ThreatScorer] Updated ${updated} user threat profiles`);
  return updated;
}

module.exports = { calculateUserThreatScore, updateAllUserThreatProfiles };
