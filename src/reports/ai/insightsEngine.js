const AIInsight = require('../../models/AIInsight');
const QueryLog = require('../../models/QueryLog');
const AuditLog = require('../../models/AuditLog');
const Payment = require('../../models/Payment');

async function generateAIInsights(tenantId, schoolId) {
  const now = new Date();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const insights = [];

  const recentQueries = await QueryLog.countDocuments({
    tenantId,
    timestamp: { $gte: dayAgo },
  });

  if (recentQueries > 100) {
    insights.push({
      title: 'Anomaly Detection Spike',
      severity: 'CRITICAL',
      recommendation: `Suspicious report query burst detected (${recentQueries} queries).`,
      confidence: 0.93,
      anomalyType: 'query_burst',
      color: 'saRed',
    });
  }

  const [thisWeekFees, lastWeekFees] = await Promise.all([
    Payment.aggregate([
      { $match: { schoolId, createdAt: { $gte: weekAgo } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Payment.aggregate([
      { $match: { schoolId, createdAt: { $gte: twoWeeksAgo, $lt: weekAgo } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
  ]);

  const thisWeek = thisWeekFees[0]?.total || 0;
  const lastWeek = lastWeekFees[0]?.total || 0;
  const drift = lastWeek > 0 ? ((thisWeek - lastWeek) / lastWeek) * 100 : 0;

  if (Math.abs(drift) > 5) {
    insights.push({
      title: 'Revenue Prediction Drift',
      severity: drift > 0 ? 'HIGH' : 'CRITICAL',
      recommendation: `Predicted ${drift > 0 ? '+' : ''}${drift.toFixed(1)}% drift vs last week.`,
      confidence: 0.89,
      anomalyType: 'revenue_drift',
      color: 'saPurple',
    });
  }

  const slowQueries = await QueryLog.countDocuments({
    tenantId,
    runtimeMs: { $gt: 500 },
    timestamp: { $gte: dayAgo },
  });

  if (slowQueries > 10) {
    insights.push({
      title: 'Infrastructure Bottleneck',
      severity: 'CRITICAL',
      recommendation: `${slowQueries} slow queries in 24h. Rebalance worker queues.`,
      confidence: 0.91,
      anomalyType: 'infrastructure',
      color: 'saTeal',
    });
  }

  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const sixAm = new Date(now);
  sixAm.setHours(6, 0, 0, 0);

  const nightActivity = await AuditLog.countDocuments({
    createdAt: { $gte: midnight, $lt: sixAm },
    action: /REPORT/i,
  }).catch(() => 0);

  if (nightActivity > 5) {
    insights.push({
      title: 'Suspicious Trend',
      severity: 'MEDIUM',
      recommendation: `Unexpected night activity in report generation (${nightActivity} events).`,
      confidence: 0.79,
      anomalyType: 'audit_anomaly',
      color: 'saBlue',
    });
  }

  const cacheHitRate = await QueryLog.aggregate([
    { $match: { tenantId, timestamp: { $gte: weekAgo } } },
    {
      $group: {
        _id: null,
        cacheHits: { $sum: { $cond: ['$cacheHit', 1, 0] } },
        total: { $sum: 1 },
      },
    },
  ]);

  const hitRate = cacheHitRate[0]
    ? cacheHitRate[0].cacheHits / Math.max(1, cacheHitRate[0].total)
    : 0;

  if (hitRate < 0.5) {
    insights.push({
      title: 'Optimization Suggestion',
      severity: 'MEDIUM',
      recommendation: `Cache hit rate is ${(hitRate * 100).toFixed(0)}%. Enable caching for repeated report filters.`,
      confidence: 0.8,
      anomalyType: 'cache_optimization',
      color: 'saGreen',
    });
  }

  if (insights.length === 0) {
    insights.push({
      title: 'System Healthy',
      severity: 'LOW',
      recommendation: 'All report pipelines are operating within normal parameters.',
      confidence: 0.95,
      anomalyType: 'status',
      color: 'saGreen',
    });
  }

  return AIInsight.insertMany(
    insights.map((i) => ({
      ...i,
      tenantId,
      schoolId,
      createdAt: new Date(),
    }))
  );
}

function generateUsageForecast(historicalData) {
  if (!historicalData.length) return 0;
  const recent = historicalData.slice(-3);
  const avg = recent.reduce((sum, value) => sum + value, 0) / recent.length;
  const growth =
    historicalData.length > 1
      ? (historicalData[historicalData.length - 1] - historicalData[0]) /
        Math.max(1, historicalData[0])
      : 0;
  return Number((avg * (1 + growth * 0.3)).toFixed(2));
}

module.exports = { generateAIInsights, generateUsageForecast };
