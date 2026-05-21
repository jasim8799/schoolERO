const RevenueSnapshot = require('../models/RevenueSnapshot');
const RevenueGrowthHistory = require('../models/RevenueGrowthHistory');
const School = require('../models/School');

async function generateRevenueForecast(currentMRR) {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000);

  const [snapshots, weekly] = await Promise.all([
    RevenueSnapshot.find({ date: { $gte: ninetyDaysAgo } }).sort({ date: 1 }).lean(),
    RevenueGrowthHistory.find({ weekStart: { $gte: ninetyDaysAgo } }).sort({ weekStart: 1 }).lean(),
  ]);

  let growthRate = 0.018;
  let confidence = 0.72;

  if (snapshots.length >= 14) {
    const recent = snapshots.slice(-14);
    const older = snapshots.slice(-28, -14);
    if (older.length > 0) {
      const recentAvgMRR = recent.reduce((s, x) => s + x.totalMRR, 0) / recent.length;
      const olderAvgMRR = older.reduce((s, x) => s + x.totalMRR, 0) / older.length;
      growthRate = olderAvgMRR > 0 ? (recentAvgMRR - olderAvgMRR) / olderAvgMRR : growthRate;
    }
    confidence = Math.min(0.95, 0.65 + snapshots.length * 0.003);
  }

  if (weekly.length >= 2) {
    const avgWeeklyGrowth = weekly.reduce((s, w) => s + (w.netGrowthPct || 0), 0) / weekly.length;
    const monthlyFromWeekly = (avgWeeklyGrowth / 100) * 4;
    growthRate = parseFloat((((growthRate * 0.6) + (monthlyFromWeekly * 0.4))).toFixed(4));
  }

  const now = new Date();
  const expiringSchools = await School.countDocuments({
    status: 'active',
    isDeleted: { $ne: true },
    'subscription.endDate': { $gte: now, $lte: new Date(now.getTime() + 30 * 86400000) },
  });
  const activeSchools = await School.countDocuments({ status: 'active', isDeleted: { $ne: true } });
  const churnRisk = activeSchools > 0 ? expiringSchools / activeSchools : 0.05;

  const forecast7d = Math.round(currentMRR * (1 + (growthRate * 7) / 30));
  const forecast30d = Math.round(currentMRR * (1 + growthRate));
  const forecast90d = Math.round(currentMRR * Math.pow(1 + growthRate, 3));
  const forecastYearly = Math.round(currentMRR * Math.pow(1 + growthRate, 12));

  const churnImpactMRR = Math.round(currentMRR * churnRisk * 0.7);
  const netForecast30d = Math.max(0, forecast30d - churnImpactMRR);

  return {
    forecast7d,
    forecast30d,
    forecast90d,
    forecastYearly,
    netForecast30d,
    growthRate: parseFloat((growthRate * 100).toFixed(2)),
    churnRisk: parseFloat((churnRisk * 100).toFixed(1)),
    churnImpactMRR,
    confidence: parseFloat(confidence.toFixed(2)),
    growthProjection: parseFloat((growthRate * 100).toFixed(2)),
    paymentConfidence: 0.79,
    forecastSeries: _buildForecastSeries(currentMRR, growthRate, 10),
  };
}

function _buildForecastSeries(currentMRR, growthRate, points) {
  return Array.from({ length: points }, (_, i) => {
    const month = i + 1;
    return parseFloat((currentMRR * Math.pow(1 + growthRate, month / 3)).toFixed(0));
  });
}

module.exports = { generateRevenueForecast };
