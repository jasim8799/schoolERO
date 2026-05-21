const { Schema, model } = require('mongoose');

const AIThreatAnalysisSchema = new Schema({
  correlationId:      { type: String, unique: true, index: true },
  eventIds:           [{ type: String }],
  schoolId:           { type: Schema.Types.ObjectId, ref: 'School', index: true },

  threatType:         { type: String },
  analysis:           { type: String },
  confidence:         { type: Number, min: 0, max: 1 },
  riskPercentage:     { type: Number },
  recommendedActions: [{ type: String }],
  anomalyPatterns:    [{ type: String }],

  mitreAttackId:      { type: String },
  mitreAttackName:    { type: String },
  mitrePhase:         { type: String },

  severity:           { type: String, enum: ['LOW','MEDIUM','HIGH','CRITICAL'] },
  autoResolved:       { type: Boolean, default: false },

  createdAt:          { type: Date, default: Date.now, index: true },
}, { timestamps: true });

// TTL: 30 days
AIThreatAnalysisSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 });

module.exports = model('AIThreatAnalysis', AIThreatAnalysisSchema);
