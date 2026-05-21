const { calculateThreatScore } = require('./threat.scorer');
const FraudAlert = require('../models/FraudAlert');
const School = require('../models/School');

async function runFraudScan() {
  const schools = await School.find({ isDeleted: false, status: 'active' }).lean();
  let alertsCreated = 0;

  for (const school of schools) {
    try {
      const daysLeft = _daysRemaining(school);
      const enrichedSchool = { ...school, daysRemaining: daysLeft };
      const { score, severity, signals } = await calculateThreatScore(school._id, enrichedSchool);

      // Skip if score is LOW
      if (score < 0.3) continue;

      // Check if a recent unresolved alert already exists for this school (last hour)
      const existingAlert = await FraudAlert.findOne({
        schoolId: school._id,
        resolved: false,
        createdAt: { $gte: new Date(Date.now() - 3600000) },
      }).lean();

      if (existingAlert) continue;

      // Determine alert type from dominant signal
      const alertType = _dominantSignal(signals);

      await FraudAlert.create({
        schoolId: school._id,
        alertType,
        severity,
        threatScore: score,
        signals,
        description: `Threat score ${Math.round(score * 100)}% — ${alertType.replace(/_/g, ' ')} detected`,
        autoBlocked: score > 0.9,
      });

      // Auto-suspend if critical threat
      if (score > 0.92) {
        await School.findByIdAndUpdate(school._id, { status: 'inactive' });
        global.io?.of('/subscriptions').emit('fraud:autosuspend', {
          schoolId: school._id, schoolName: school.name, score,
        });
      }

      // Broadcast alert via Socket.IO
      global.io?.of('/subscriptions').emit('fraud:alert', {
        schoolId: school._id, schoolName: school.name, severity, score, alertType,
      });

      alertsCreated++;
    } catch (err) {
      console.error(`[FraudScan] Error for ${school._id}:`, err.message);
    }
  }

  console.log(`[FraudScan] Completed. ${alertsCreated} alerts created.`);
  return alertsCreated;
}

function _dominantSignal(signals) {
  const signalTypes = {
    failedPayments: 'FAILED_PAYMENT_SPIKE',
    failedLogins: 'BRUTE_FORCE',
    apiAbuse: 'API_ABUSE',
    subscriptionExpiry: 'CHURN_RISK',
    rapidPlanSwitch: 'RAPID_PLAN_SWITCH',
  };
  let maxScore = 0;
  let dominant = 'CHURN_RISK';
  for (const [key, val] of Object.entries(signals || {})) {
    if ((val.score || 0) > maxScore && signalTypes[key]) {
      maxScore = val.score;
      dominant = signalTypes[key];
    }
  }
  return dominant;
}

function _daysRemaining(school) {
  if (!school.subscription?.endDate) return 0;
  return Math.ceil((new Date(school.subscription.endDate) - new Date()) / 86400000);
}

module.exports = { runFraudScan };
