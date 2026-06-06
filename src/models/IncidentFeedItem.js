const { Schema, model } = require('mongoose');

const IncidentFeedItemSchema = new Schema({
  // Identification
  feedItemId:        { type: String, unique: true, index: true },
  correlationId:     { type: String, index: true },
  incidentId:        { type: Schema.Types.ObjectId, ref: 'SecurityIncident', index: true },
  
  // Event details
  event:             { type: String, required: true },
  eventType:         {
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
    ],
    index: true,
  },
  
  // Severity & Status
  severity:          {
    type: String,
    enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    index: true,
  },
  status:            {
    type: String,
    enum: ['ACTIVE', 'INVESTIGATING', 'RESOLVED', 'ARCHIVED'],
    default: 'ACTIVE',
    index: true,
  },
  
  // Tenant isolation
  schoolId:          { type: Schema.Types.ObjectId, ref: 'School', index: true },
  userId:            { type: Schema.Types.ObjectId, ref: 'User', index: true },
  
  // Network/Location
  ipAddress:         { type: String, required: true, index: true },
  country:           { type: String },
  city:              { type: String },
  category:          { type: String }, // e.g., 'Authentication', 'Network', etc.
  
  // Timing
  timestamp:         { type: Date, default: Date.now, index: true },
  detectionTime:     { type: Date },
  responseTime:      { type: Date },
  
  // AI Intelligence
  aiConfidence:      { type: Number, min: 0, max: 1, default: 0.8 },
  riskScore:         { type: Number, min: 0, max: 1, default: 0.5 },
  threatDescription: { type: String },
  
  // Automated Response
  response:          {
    type: String,
    enum: [
      'NO_ACTION',
      'ALERT',
      'LOG_ONLY',
      'WARN_USER',
      'REQUIRE_MFA',
      'BLOCK_IP',
      'LOCK_ACCOUNT',
      'INITIATE_INVESTIGATION',
      'ESCALATE_TO_ADMIN',
    ],
    default: 'NO_ACTION',
  },
  responseDetails:   { type: String },
  
  // Metadata
  source:            { type: String }, // e.g., 'auth.controller', 'firewall', etc.
  icon:              { type: String },
  relatedEventIds:   [{ type: String }],
  
  isDeleted:         { type: Boolean, default: false },
  createdAt:         { type: Date, default: Date.now, index: true },
}, { timestamps: false });

// Indexes
IncidentFeedItemSchema.index({ schoolId: 1, timestamp: -1 });
IncidentFeedItemSchema.index({ severity: 1, status: 1 });
IncidentFeedItemSchema.index({ ipAddress: 1, timestamp: -1 });
IncidentFeedItemSchema.index({ eventType: 1 });
IncidentFeedItemSchema.index({ aiConfidence: -1 });
IncidentFeedItemSchema.index({ riskScore: -1 });
// TTL: 60 days
IncidentFeedItemSchema.index({ timestamp: 1 }, { expireAfterSeconds: 5184000 });

module.exports = model('IncidentFeedItem', IncidentFeedItemSchema);
