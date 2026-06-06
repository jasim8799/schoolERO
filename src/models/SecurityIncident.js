const { Schema, model } = require('mongoose');

const SecurityIncidentSchema = new Schema({
  // Unique identifier
  incidentId:        { type: String, unique: true, index: true }, // INC-2024-001234
  correlationId:     { type: String, index: true },
  
  // Basic incident info
  title:             { type: String, required: true },
  description:       { type: String },
  incidentType:      {
    type: String,
    enum: [
      'FAILED_LOGIN',
      'BRUTE_FORCE',
      'ACCOUNT_LOCK',
      'SUSPICIOUS_IP',
      'SESSION_HIJACK',
      'GEO_ANOMALY',
      'FIREWALL_BLOCK',
      'INJECTION_ATTEMPT',
      'PRIVILEGE_ESCALATION',
      'ADMIN_ABUSE',
      'API_ABUSE',
      'MALWARE_DETECTION',
      'DATA_EXFILTRATION',
      'DDoS_ATTACK',
      'CREDENTIAL_STUFFING',
    ],
    index: true,
  },
  
  // Status
  status:            {
    type: String,
    enum: ['DETECTED', 'INVESTIGATING', 'CONTAINMENT', 'ERADICATION', 'RECOVERY', 'RESOLVED', 'CLOSED'],
    default: 'DETECTED',
    index: true,
  },
  
  // Severity & Risk
  severity:          {
    type: String,
    enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    default: 'MEDIUM',
    index: true,
  },
  riskScore:         { type: Number, min: 0, max: 1, default: 0.5 },
  aiConfidence:      { type: Number, min: 0, max: 1, default: 0.8 },
  
  // Affected entities
  schoolId:          { type: Schema.Types.ObjectId, ref: 'School', index: true },
  userId:            { type: Schema.Types.ObjectId, ref: 'User', index: true },
  affectedUsers:     [{ type: Schema.Types.ObjectId, ref: 'User' }],
  
  // Network details
  sourceIpAddress:   { type: String, index: true },
  sourceCountry:     { type: String },
  sourceCity:        { type: String },
  targetSystem:      { type: String },
  
  // AI Analysis
  aiAnalysis:        { type: String },
  threatCategories:  [{ type: String }], // MITRE ATT&CK tactics
  mitreTactics:      [{ type: String }], // reconnaissance, execution, etc.
  mitreId:           { type: String },
  
  // Response
  detectionMethod:   {
    type: String,
    enum: ['AI_DETECTION', 'RULE_MATCH', 'MANUAL_REPORT', 'AUTOMATED_ALERT', 'ANOMALY_DETECTION'],
  },
  responseActions:   [{
    action:          { type: String },
    description:     { type: String },
    status:          { type: String, enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED'] },
    executedBy:      { type: Schema.Types.ObjectId, ref: 'User' },
    executedAt:      { type: Date },
    result:          { type: String },
  }],
  containmentStatus: { type: String, enum: ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'] },
  
  // Timeline
  detectedAt:        { type: Date, default: Date.now, index: true },
  firstSeenAt:       { type: Date },
  lastSeenAt:        { type: Date },
  resolvedAt:        { type: Date },
  closedAt:          { type: Date },
  
  // Related events
  relatedEventIds:   [{ type: String }],
  relatedIncidents:  [{ type: Schema.Types.ObjectId, ref: 'SecurityIncident' }],
  
  // Assignment
  assignedTo:        { type: Schema.Types.ObjectId, ref: 'User' },
  assignedAt:        { type: Date },
  
  // Escalation
  escalationLevel:   { type: Number, default: 0, min: 0, max: 5 },
  escalatedTo:       { type: Schema.Types.ObjectId, ref: 'User' },
  escalationReason:  { type: String },
  
  // Metrics
  eventCount:        { type: Number, default: 1 },
  affectedCount:     { type: Number, default: 1 },
  
  // Notes
  notes:             [{ 
    author:          { type: Schema.Types.ObjectId, ref: 'User' },
    text:            { type: String },
    createdAt:       { type: Date, default: Date.now },
  }],
  
  // Metadata
  tags:              [{ type: String }],
  priority:          { type: Number, default: 5 }, // 1-10, 1 = highest
  isDeleted:         { type: Boolean, default: false },
  
  createdAt:         { type: Date, default: Date.now, index: true },
}, { timestamps: true });

// Indexes for querying
SecurityIncidentSchema.index({ schoolId: 1, severity: 1, createdAt: -1 });
SecurityIncidentSchema.index({ status: 1, severity: 1 });
SecurityIncidentSchema.index({ sourceIpAddress: 1 });
SecurityIncidentSchema.index({ userId: 1, createdAt: -1 });
SecurityIncidentSchema.index({ incidentType: 1, status: 1 });
SecurityIncidentSchema.index({ assignedTo: 1, status: 1 });
SecurityIncidentSchema.index({ riskScore: -1 });
SecurityIncidentSchema.index({ aiConfidence: -1 });
// TTL: 180 days
SecurityIncidentSchema.index({ createdAt: 1 }, { expireAfterSeconds: 15552000 });

module.exports = model('SecurityIncident', SecurityIncidentSchema);

