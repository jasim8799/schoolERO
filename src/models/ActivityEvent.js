const { Schema, model } = require('mongoose');

const ActivityEventSchema = new Schema({
  eventId:       { type: String, unique: true, index: true },
  correlationId: { type: String, index: true },

  // Core event fields
  event:         { type: String, required: true },
  type:          { type: String, enum: ['auth','firewall','api','database','payment','user activity','ai','server','system'], default: 'system', index: true },
  source:        { type: String },
  icon:          { type: String, default: 'article' },

  // Severity + status
  severity:      { type: String, enum: ['INFO','WARNING','ERROR','CRITICAL','BLOCKED','MONITORING'], default: 'INFO', index: true },
  status:        { type: String, enum: ['RESOLVED','MONITORING','INVESTIGATING','BLOCKED'], default: 'RESOLVED', index: true },

  // AI intelligence
  aiScore:       { type: Number, min: 0, max: 1, default: 0.78 },
  threat:        { type: Number, min: 0, max: 1, default: 0 },
  aiAnalysis:    { type: String },
  aiConfidence:  { type: Number, min: 0, max: 1 },

  // Network intelligence
  ipAddress:     { type: String, index: true },
  region:        { type: String, default: 'India' },
  vpnDetected:   { type: Boolean, default: false },
  geoCountry:    { type: String },
  geoCity:       { type: String },
  asnInfo:       { type: String },

  // Response
  response:      { type: String },
  responseType:  { type: String, enum: ['AUTOMATED','MANUAL','NONE'], default: 'NONE' },
  responseActions: [{ action: String, executedAt: Date, executedBy: String }],

  // Tenant isolation
  schoolId:      { type: Schema.Types.ObjectId, ref: 'School', index: true },
  userId:        { type: Schema.Types.ObjectId, ref: 'User', index: true },

  // Source reference
  sourceLogId:   { type: Schema.Types.ObjectId, ref: 'AuditLog' },
  sourceLogs: [{
    raw:   { type: String },
    level: { type: String },
    ts:    { type: Date },
  }],

  // Incident tracking
  incidentId:      { type: String, index: true },
  isIncident:      { type: Boolean, default: false },
  assignedTo:      { type: Schema.Types.ObjectId, ref: 'User' },
  escalationLevel: { type: Number, default: 0 },

  // Related events
  relatedEventIds: [{ type: String }],

  // Audit
  entityType:  { type: String },
  action:      { type: String },
  description: { type: String },
  metadata:    { type: Schema.Types.Mixed },

  isDeleted:  { type: Boolean, default: false },
  createdAt:  { type: Date, default: Date.now, index: true },
}, { timestamps: false });

ActivityEventSchema.index({ severity: 1, createdAt: -1 });
ActivityEventSchema.index({ status: 1, severity: 1 });
ActivityEventSchema.index({ ipAddress: 1, createdAt: -1 });
ActivityEventSchema.index({ type: 1, createdAt: -1 });
ActivityEventSchema.index({ aiScore: -1 });
ActivityEventSchema.index({ threat: -1 });
// TTL: 90 days
ActivityEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 });

module.exports = model('ActivityEvent', ActivityEventSchema);
