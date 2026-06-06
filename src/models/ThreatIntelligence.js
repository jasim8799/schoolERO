const { Schema, model } = require('mongoose');

const ThreatIntelligenceSchema = new Schema({
  // Identification
  threatIntelId:     { type: String, unique: true, index: true },
  correlationId:     { type: String, index: true },
  
  // Intelligence details
  title:             { type: String, required: true },
  analysis:          { type: String, required: true },
  threatDescription: { type: String },
  
  // Severity & Confidence
  severity:          {
    type: String,
    enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    default: 'MEDIUM',
    index: true,
  },
  confidence:        { type: Number, min: 0, max: 1, default: 0.8 },
  impact:            {
    type: String,
    enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    default: 'MEDIUM',
  },
  
  // Tenant isolation
  schoolId:          { type: Schema.Types.ObjectId, ref: 'School', index: true },
  
  // Threat type
  threatType:        {
    type: String,
    enum: [
      'BRUTE_FORCE',
      'CREDENTIAL_STUFFING',
      'INJECTION',
      'UNAUTHORIZED_ACCESS',
      'PRIVILEGE_ESCALATION',
      'DATA_EXFILTRATION',
      'MALWARE',
      'DDOS',
      'SESSION_HIJACK',
      'API_ABUSE',
      'ADMIN_ABUSE',
      'FIREWALL_VIOLATION',
      'SUSPICIOUS_BEHAVIOR',
    ],
    index: true,
  },
  
  // MITRE ATT&CK Framework
  mitreTactics:      [{ type: String }], // e.g., 'reconnaissance', 'execution'
  mitreId:           { type: String },
  
  // Sources
  sourceEventIds:    [{ type: String }],
  sourceIncidentIds: [{ type: Schema.Types.ObjectId, ref: 'SecurityIncident' }],
  
  // Recommendations
  recommendation:    { type: String },
  recommendedActions: [{ type: String }],
  remediationSteps:  [{ type: String }],
  
  // Detection details
  detectionMethod:   {
    type: String,
    enum: ['AI_ANALYSIS', 'RULE_ENGINE', 'BEHAVIORAL_ANALYSIS', 'SIGNATURE_MATCH', 'MANUAL'],
    default: 'AI_ANALYSIS',
  },
  
  // Affected systems
  affectedSystem:    { type: String },
  affectedUsers:     [{ type: Schema.Types.ObjectId, ref: 'User' }],
  affectedCount:     { type: Number, default: 1 },
  
  // Risk assessment
  riskScore:         { type: Number, min: 0, max: 1, default: 0.5 },
  exploitability:    { type: Number, min: 0, max: 1 },
  accessibility:     { type: Number, min: 0, max: 1 },
  
  // Remediation
  remediationStatus: {
    type: String,
    enum: ['PENDING', 'IN_PROGRESS', 'MITIGATED', 'RESOLVED', 'ACCEPTED_RISK'],
    default: 'PENDING',
  },
  remediationDate:   { type: Date },
  
  // Metadata
  tags:              [{ type: String }],
  externalReferences: [{ type: String }], // e.g., CVE numbers
  relatedIntel:      [{ type: Schema.Types.ObjectId, ref: 'ThreatIntelligence' }],
  
  isDeleted:         { type: Boolean, default: false },
  createdAt:         { type: Date, default: Date.now, index: true },
  updatedAt:         { type: Date, default: Date.now },
  expiresAt:         { type: Date }, // Intelligence becomes stale after a time
}, { timestamps: false });

// Indexes
ThreatIntelligenceSchema.index({ schoolId: 1, createdAt: -1 });
ThreatIntelligenceSchema.index({ severity: 1, confidence: -1 });
ThreatIntelligenceSchema.index({ threatType: 1 });
ThreatIntelligenceSchema.index({ riskScore: -1 });
ThreatIntelligenceSchema.index({ remediationStatus: 1 });
ThreatIntelligenceSchema.index({ mitreTactics: 1 });
// TTL: 90 days
ThreatIntelligenceSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 });

module.exports = model('ThreatIntelligence', ThreatIntelligenceSchema);
