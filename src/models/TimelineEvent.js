const { Schema, model } = require('mongoose');

const TimelineEventSchema = new Schema({
  // Identification
  timelineEventId:   { type: String, unique: true, index: true },
  incidentId:        { type: Schema.Types.ObjectId, ref: 'SecurityIncident', index: true },
  correlationId:     { type: String, index: true },
  
  // Timeline phase
  phase:             {
    type: String,
    enum: [
      'DETECTION',
      'CLASSIFICATION',
      'CONTAINMENT',
      'INVESTIGATION',
      'RESPONSE',
      'REMEDIATION',
      'MITIGATION',
      'RECOVERY',
      'RESOLUTION',
      'CLOSURE',
    ],
    required: true,
    index: true,
  },
  
  // Event details
  title:             { type: String, required: true },
  description:       { type: String },
  details:           { type: String },
  
  // Severity & Status
  severity:          {
    type: String,
    enum: ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    index: true,
  },
  
  // Tenant isolation
  schoolId:          { type: Schema.Types.ObjectId, ref: 'School', index: true },
  userId:            { type: Schema.Types.ObjectId, ref: 'User', index: true },
  
  // Network details
  ipAddress:         { type: String },
  source:            { type: String }, // e.g., 'auth.controller', 'firewall', 'ai_engine'
  
  // Timing
  occurredAt:        { type: Date, required: true },
  createdAt:         { type: Date, default: Date.now, index: true },
  
  // Related data
  relatedEventIds:   [{ type: String }],
  relatedIncidents:  [{ type: Schema.Types.ObjectId, ref: 'SecurityIncident' }],
  
  // Action taken
  action:            { type: String }, // Description of action taken
  actionType:        { type: String, enum: ['AUTOMATED', 'MANUAL', 'NONE'] },
  actionBy:          { type: Schema.Types.ObjectId, ref: 'User' },
  
  // Evidence
  evidence:          [{ type: String }],
  attachments:       [{ url: String, type: String }],
  
  // Metadata
  tags:              [{ type: String }],
  priority:          { type: Number, default: 5 },
  isDeleted:         { type: Boolean, default: false },
  
}, { timestamps: false });

// Indexes
TimelineEventSchema.index({ incidentId: 1, occurredAt: 1 });
TimelineEventSchema.index({ schoolId: 1, occurredAt: -1 });
TimelineEventSchema.index({ phase: 1, severity: 1 });
TimelineEventSchema.index({ createdAt: 1 });
TimelineEventSchema.index({ occurredAt: -1 });
// TTL: 180 days
TimelineEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 15552000 });

module.exports = model('TimelineEvent', TimelineEventSchema);
