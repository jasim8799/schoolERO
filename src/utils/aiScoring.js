function scoreBand(score) {
  const normalized = Math.max(0, Math.min(1, Number(score || 0)));
  if (normalized >= 0.8) return 'CRITICAL';
  if (normalized >= 0.6) return 'HIGH';
  if (normalized >= 0.35) return 'MEDIUM';
  return 'LOW';
}

module.exports = { scoreBand };
