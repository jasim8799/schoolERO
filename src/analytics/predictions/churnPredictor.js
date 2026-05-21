function predictChurn(features = {}) {
  const health = Number(features.healthScore || 0);
  const attendance = Number(features.attendancePct || 0);
  const daysToExpiry = Number(features.daysToExpiry || 0);

  const score = Math.max(
    0,
    Math.min(
      1,
      0.2 + (health < 60 ? 0.35 : 0) + (attendance < 75 ? 0.2 : 0) + (daysToExpiry < 21 ? 0.3 : 0)
    )
  );

  return {
    churnProbability: Number(score.toFixed(3)),
    band: score > 0.7 ? 'HIGH' : score > 0.4 ? 'MEDIUM' : 'LOW'
  };
}

module.exports = { predictChurn };
