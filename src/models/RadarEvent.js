const { Schema, model } = require('mongoose');

const RadarEventSchema = new Schema({
  // Identification
  radarEventId:      { type: String, unique: true, index: true },
  correlationId:     { type: String, index: true },
  
  // Threat details
  threatType:        {
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
      'API_ABUSE',
      'PRIVILEGE_ESCALATION',
      'MALWARE_DETECTION',
      'DATA_EXFILTRATION',
      'DDoS_ATTACK',
      'CREDENTIAL_STUFFING',
      'ADMIN_ABUSE',
    ],
    required: true,
    index: true,
  },
  
  // Geographic coordinates for radar visualization
  ipAddress:         { type: String, required: true, index: true },
  latitude:          { type: Number, required: true },
  longitude:         { type: Number, required: true },
  country:           { type: String, required: true },
  city:              { type: String },
  
  // Risk assessment
  severity:          {
    type: String,
    enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    index: true,
  },
  riskScore:         { type: Number, min: 0, max: 1, default: 0.5, index: true },
  threatLevel:       { type: Number, min: 0, max: 100 }, // Percentage for UI
  
  // Tenant isolation
  schoolId:          { type: Schema.Types.ObjectId, ref: 'School', index: true },
  userId:            { type: Schema.Types.ObjectId, ref: 'User', index: true },
  
  // Source event
  sourceEventId:     { type: String },
  incidentId:        { type: Schema.Types.ObjectId, ref: 'SecurityIncident' },
  
  // AI Intelligence
  confidence:        { type: Number, min: 0, max: 1, default: 0.8 },
  analysisText:      { type: String },
  
  // Metadata
  source:            { type: String }, // e.g., 'firewall', 'auth', 'ai_engine'
  description:       { type: String },
  icon:              { type: String }, // For UI display
  
  // Network info
  asn:               { type: String },
  ispName:           { type: String },
  vpnDetected:       { type: Boolean, default: false },
  proxyDetected:     { type: Boolean, default: false },
  torDetected:       { type: Boolean, default: false },
  
  // Status
  status:            {
    type: String,
    enum: ['ACTIVE', 'INVESTIGATING', 'MITIGATED', 'BLOCKED'],
    default: 'ACTIVE',
    index: true,
  },
  
  // Timing
  detectedAt:        { type: Date, default: Date.now, index: true },
  expiresAt:         { type: Date }, // Automatically remove after a time window
  
  // Related events
  relatedEventIds:   [{ type: String }],
  eventCount:        { type: Number, default: 1 }, // How many events triggered this radar point
  
  // Persistence
  isDeleted:         { type: Boolean, default: false },
  createdAt:         { type: Date, default: Date.now, index: true },
}, { timestamps: false });

// Indexes
RadarEventSchema.index({ schoolId: 1, detectedAt: -1 });
RadarEventSchema.index({ threatType: 1, severity: 1 });
RadarEventSchema.index({ ipAddress: 1 });
RadarEventSchema.index({ riskScore: -1 });
RadarEventSchema.index({ status: 1 });
RadarEventSchema.index({ confidence: -1 });
// Geospatial index for map queries
RadarEventSchema.index({ latitude: '2dsphere', longitude: '2dsphere' });
// TTL: 24 hours (live radar only shows active threats)
RadarEventSchema.index({ detectedAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = model('RadarEvent', RadarEventSchema);
