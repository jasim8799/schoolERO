function calculateCashflowMetrics(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  if (!safeRows.length) {
    return {
      avgCashflow: 0,
      avgBillingHealth: 0,
      avgFraudScore: 0,
      paymentSuccessRate: 0,
    };
  }

  const avgCashflow = safeRows.reduce((s, r) => s + (r.cashflow || 0), 0) / safeRows.length;
  const avgBillingHealth = safeRows.reduce((s, r) => s + (r.billingHealth || 0), 0) / safeRows.length;
  const avgFraudScore = safeRows.reduce((s, r) => s + (r.fraudScore || 0), 0) / safeRows.length;
  const paid = safeRows.filter((r) => r.paymentStatus === 'PAID').length;

  return {
    avgCashflow: parseFloat(avgCashflow.toFixed(2)),
    avgBillingHealth: parseFloat(avgBillingHealth.toFixed(2)),
    avgFraudScore: parseFloat(avgFraudScore.toFixed(3)),
    paymentSuccessRate: parseFloat(((paid / safeRows.length) * 100).toFixed(1)),
  };
}

module.exports = { calculateCashflowMetrics };
