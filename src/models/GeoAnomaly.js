const { Schema, model } = require('mongoose');

const GeoAnomalySchema = new Schema({
  // Identification
  anomalyId:         { type: String, unique: true, index: true },
  correlationId:     { type: String, index: true },
  
  // User details
  schoolId:          { type: Schema.Types.ObjectId, ref: 'School', index: true },
  userId:            { type: Schema.Types.ObjectId, ref: 'User', index: true },
  email:             { type: String, index: true },
  
  // Current location
  country:           { type: String, required: true, index: true },
  city:              { type: String },
  latitude:          { type: Number },
  longitude:         { type: Number },
  ipAddress:         { type: String, index: true },
  
  // Previous location
  previousCountry:   { type: String },
  previousCity:      { type: String },
  previousLatitude:  { type: Number },
  previousLongitude: { type: Number },
  previousIpAddress: { type: String },
  
  // Anomaly type
  anomalyType:       {
    type: String,
    enum: [
      'NEW_COUNTRY',
      'NEW_CITY',
      'IMPOSSIBLE_TRAVEL',
      'VPN_DETECTED',
      'TOR_DETECTED',
      'PROXY_DETECTED',
      'DATACENTER_IP',
      'RESIDENTIAL_CHANGE',
      'TIMEZONE_JUMP',
      'VELOCITY_VIOLATION',
    ],
    index: true,
  },
  
  // Risk assessment
  severity:          {
    type: String,
    enum: ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    default: 'MEDIUM',
    index: true,
  },
  riskScore:         { type: Number, min: 0, max: 1, default: 0.5 },
  
  // VPN/Proxy detection
  vpn:               { type: Boolean, default: false },
  proxy:             { type: Boolean, default: false },
  tor:               { type: Boolean, default: false },
  dataCenterIp:      { type: Boolean, default: false },
  isPrivate:         { type: Boolean, default: false },
  
  // Distance calculation
  distanceKm:        { type: Number }, // Distance from previous location
  travelTimeHours:   { type: Number }, // Time between logins
  requiredSpeedKph:  { type: Number }, // Required speed for travel
  isImpossibleTravel: { type: Boolean, default: false },
  
  // Provider info
  asn:               { type: String },
  ispName:           { type: String },
  isp:               { type: String },
  
  // Detection
  detectionMethod:   {
    type: String,
    enum: ['AI_DETECTION', 'RULE_MATCH', 'THRESHOLD_VIOLATION'],
    default: 'AI_DETECTION',
  },
  
  // Status
  status:            {
    type: String,
    enum: ['DETECTED', 'INVESTIGATING', 'VERIFIED_SAFE', 'BLOCKED', 'RESOLVED'],
    default: 'DETECTED',
    index: true,
  },
  
  // Verification
  userVerified:      { type: Boolean, default: false },
  verificationToken: { type: String },
  verificationMethod: { type: String, enum: ['EMAIL', 'SMS', 'SECURITY_QUESTION', 'MANUAL'] },
  verifiedAt:        { type: Date },
  
  // Response
  responseAction:    { type: String, enum: ['MONITOR', 'WARN', 'REQUIRE_MFA', 'BLOCK', 'NONE'] },
  responseExecutedAt: { type: Date },
  
  // Event tracking
  relatedEventIds:   [{ type: String }],
  incidentId:        { type: Schema.Types.ObjectId, ref: 'SecurityIncident' },
  
  // Metadata
  userAgent:         { type: String },
  deviceHash:        { type: String },
  sessionId:         { type: String },
  
  isDeleted:         { type: Boolean, default: false },
  createdAt:         { type: Date, default: Date.now, index: true },
}, { timestamps: true });

// Indexes
GeoAnomalySchema.index({ schoolId: 1, createdAt: -1 });
GeoAnomalySchema.index({ userId: 1, createdAt: -1 });
GeoAnomalySchema.index({ country: 1, userId: 1 });
GeoAnomalySchema.index({ status: 1, severity: 1 });
GeoAnomalySchema.index({ ipAddress: 1 });
GeoAnomalySchema.index({ isImpossibleTravel: 1 });
GeoAnomalySchema.index({ riskScore: -1 });
// TTL: 90 days
GeoAnomalySchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 });

module.exports = model('GeoAnomaly', GeoAnomalySchema);

