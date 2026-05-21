function predictDropoutRisk(features = {}) {
  const attendance = Number(features.attendancePct || 0);
  const feeDueMonths = Number(features.feeDueMonths || 0);
  const lowPerformanceFlags = Number(features.lowPerformanceFlags || 0);

  const risk = Math.max(
    0,
    Math.min(
      1,
      0.1 + (attendance < 70 ? 0.4 : 0) + Math.min(0.3, feeDueMonths * 0.08) + Math.min(0.2, lowPerformanceFlags * 0.05)
    )
  );

  return {
    dropoutRisk: Number(risk.toFixed(3)),
    label: risk > 0.7 ? 'CRITICAL' : risk > 0.45 ? 'ELEVATED' : 'LOW'
  };
}

module.exports = { predictDropoutRisk };
