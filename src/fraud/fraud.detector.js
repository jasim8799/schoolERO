const { calculateThreatScore } = require('./threat.scorer');
const FraudAlert = require('../models/FraudAlert');
const School = require('../models/School');
const { auditLog } = require('../utils/auditLog');

async function runFraudScan() {
  const schools = await School.find({ isDeleted: false, status: 'active' }).lean();
  let alertsCreated = 0;
  const fraudThreshold = 0.92;

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
      if (score > fraudThreshold) {
        const now = new Date();
        const subStart = school?.subscription?.startDate ? new Date(school.subscription.startDate) : null;
        const subEnd = school?.subscription?.endDate ? new Date(school.subscription.endDate) : null;
        const gracePeriodDays = Number(school?.subscription?.gracePeriodDays ?? 30);
        const daysRemaining = subEnd && Number.isFinite(subEnd.getTime())
          ? Math.ceil((subEnd.getTime() - now.getTime()) / 86400000)
          : null;
        const weightedBreakdown = _buildWeightedBreakdown(signals);
        const dominant = _dominantSignal(signals);
        const triggeredCondition = `score>${fraudThreshold} | ${score}>${fraudThreshold}`;

        console.log('===== SCHOOL SUSPENSION =====');
        console.log('Job:', 'fraudDetector.runFraudScan');
        console.log('Timestamp:', now.toISOString());
        console.log('School:', school.name || 'Unknown');
        console.log('School ID:', school._id?.toString?.() || String(school._id));
        console.log('Old Status:', school.status);
        console.log('New Status:', 'inactive');
        console.log('Current Date:', now.toISOString());
        console.log('Subscription Start:', subStart ? subStart.toISOString() : 'N/A');
        console.log('Subscription End:', subEnd ? subEnd.toISOString() : 'Invalid Date');
        console.log('Days Remaining:', daysRemaining);
        console.log('Grace Period:', gracePeriodDays);
        console.log('Fraud Score:', score);
        console.log('Fraud Threshold:', fraudThreshold);
        console.log('Signals:', JSON.stringify(signals || {}));
        console.log('Dominant Rule:', dominant);
        console.log('Weighted Contributions:', JSON.stringify(weightedBreakdown));
        console.log('Reason:', 'Verified fraud policy threshold exceeded');
        console.log('Condition:', triggeredCondition);
        console.log('Call Stack:', new Error('[fraud.detector] school suspension').stack);
        console.log('=============================');

        await auditLog({
          action: 'SCHOOL_AUTO_SUSPENDED_FRAUD',
          role: 'SYSTEM',
          category: 'SECURITY',
          entityType: 'SCHOOL',
          entityId: school._id,
          entityName: school.name,
          schoolId: school._id,
          schoolName: school.name,
          description: `School auto-suspended by fraud detector: ${school.name || school._id}`,
          details: {
            jobName: 'fraudDetector.runFraudScan',
            automatic: true,
            operator: 'SYSTEM',
            oldStatus: school.status,
            newStatus: 'inactive',
            reason: 'Verified fraud policy threshold exceeded',
            currentDate: now.toISOString(),
            subscriptionStartDate: subStart ? subStart.toISOString() : null,
            subscriptionEndDate: subEnd ? subEnd.toISOString() : null,
            gracePeriodDays,
            daysRemaining,
            subscriptionStatus: school?.subscription?.status || null,
            planStatus: school?.plan || null,
            fraudScore: score,
            fraudThreshold,
            severity,
            dominantSignal: dominant,
            signals: signals || {},
            weightedContributions: weightedBreakdown,
            triggeredCondition,
            whyExceeded: `Fraud score ${score} exceeded threshold ${fraudThreshold}`,
            callStack: new Error('[fraud.detector] school suspension audit').stack,
          },
        });

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

function _buildWeightedBreakdown(signals = {}) {
  const weights = {
    failedPayments: 0.25,
    failedLogins: 0.20,
    apiAbuse: 0.15,
    subscriptionExpiry: 0.15,
    rapidPlanSwitch: 0.10,
    unusualLocation: 0.10,
    concurrentSessions: 0.05,
  };

  const entries = [];
  for (const [key, weight] of Object.entries(weights)) {
    const base = Number(signals?.[key]?.score || 0);
    entries.push({ signal: key, score: base, weight, contribution: Number((base * weight).toFixed(4)) });
  }
  return entries.sort((a, b) => b.contribution - a.contribution);
}

module.exports = { runFraudScan };
