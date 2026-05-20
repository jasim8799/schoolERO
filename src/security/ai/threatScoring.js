const crypto = require('crypto');

function generateThreatId(prefix = 'THR') {
	const ts = Date.now().toString(36).toUpperCase();
	const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
	return `${prefix}-${ts}-${rand}`;
}

function scoreThreat(input = {}) {
	const severity = (input.severity || 'LOW').toString().toUpperCase();
	const base = {
		LOW: 0.25,
		MEDIUM: 0.5,
		HIGH: 0.75,
		CRITICAL: 0.92,
	}[severity] ?? 0.3;

	const anomalyBoost = Math.min(0.2, ((input.anomalies || 0) / 100));
	const confidence = Math.max(0.5, Math.min(0.99, base + anomalyBoost));
	const risk = Math.max(0.1, Math.min(1, base + anomalyBoost / 2));

	return {
		risk: Number(risk.toFixed(2)),
		confidence: Number(confidence.toFixed(2)),
	};
}

module.exports = {
	generateThreatId,
	scoreThreat,
};
