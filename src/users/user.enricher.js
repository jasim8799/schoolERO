const AuditLog = require('../models/AuditLog');
const LoginSession = require('../models/LoginSession');
const SecurityLog = require('../models/SecurityLog');
const redis = require('../config/redis');

const safeQuery = (promise, fallback) => Promise.race([
  promise,
  new Promise((resolve) => setTimeout(() => resolve(fallback), 2000))
]).catch(() => fallback);

async function enrichUserForDashboard(user) {
  const now = new Date();
  const dayAgo = new Date(now - 86400000);

  let failedLogins = 0;
  let successLogins = 0;
  let activeSessions = 0;
  let liveDevices = 0;
  let sessionTokens = 0;
  let lastSession = null;
  let vpnDetected = false;

  try {
    const [failedCount, successCount, activeSessionDocs, vpnLog] = await Promise.all([
      safeQuery(AuditLog.countDocuments({
        userId: user._id,
        action: { $in: ['LOGIN_FAILED', 'INVALID_TOKEN'] },
        createdAt: { $gte: dayAgo },
      }), 0),
      safeQuery(AuditLog.countDocuments({
        userId: user._id,
        action: 'LOGIN_SUCCESS',
        createdAt: { $gte: dayAgo },
      }), 0),
      safeQuery(LoginSession.find({ userId: user._id, isActive: true })
        .select('deviceHash ipAddress geoCity geoCountry userAgent loginAt')
        .lean(), []),
      safeQuery(SecurityLog.findOne({ userId: user._id, eventType: 'GEO_ANOMALY' }).sort({ createdAt: -1 }).lean(), null),
    ]);

    failedLogins = failedCount;
    successLogins = successCount;
    activeSessions = activeSessionDocs.length;
    sessionTokens = activeSessionDocs.length + successCount;
    vpnDetected = !!vpnLog;

    const deviceHashes = new Set(activeSessionDocs.map((s) => s.deviceHash).filter(Boolean));
    liveDevices = Math.max(1, deviceHashes.size);

    if (activeSessionDocs.length > 0) {
      lastSession = activeSessionDocs.sort((a, b) => new Date(b.loginAt) - new Date(a.loginAt))[0];
    }
  } catch (err) {
    console.error(`[enrichUser] ${user._id}:`, err.message);
  }

  const cachedThreats = await safeQuery(redis.get(`threat:user:${user._id}`), null);
  let threatScore = user.threatScore || 0;
  let riskLevel = user.riskLevel || 'LOW';

  if (cachedThreats) {
    const parsed = JSON.parse(cachedThreats);
    threatScore = parsed.score || threatScore;
    riskLevel = parsed.riskLevel || riskLevel;
  }

  const ua = lastSession?.userAgent || user.lastKnownDevice || '';
  const deviceLabel = _extractDevice(ua);
  const ipAddress = lastSession?.ipAddress || user.lastKnownIp || 'N/A';
  const location = lastSession?.geoCity
    ? `${lastSession.geoCity}, ${lastSession.geoCountry || 'IN'}`
    : (user.city ? `${user.city}, IN` : 'N/A');

  return {
    _id: user._id.toString(),
    name: user.name,
    email: user.email,
    mobile: user.mobile,
    role: user.role,
    status: user.status,
    schoolId: user.schoolId,

    department: user.department || 'N/A',
    employeeId: user.employeeId || user._id.toString().slice(-6).toUpperCase(),
    designation: user.designation || null,
    qualification: user.qualification || null,
    experienceYears: user.experienceYears || 0,
    previousSchool: user.previousSchool || null,
    dateOfJoining: user.dateOfJoining || null,

    mfaEnabled: user.mfaEnabled || false,
    encrypted: user.encrypted !== false,
    apiAccess: user.apiAccess || ['SUPER_ADMIN', 'PRINCIPAL'].includes(user.role),
    vpnDetected,

    threatScore: parseFloat(Number(threatScore || 0).toFixed(2)),
    riskLevel,

    failedLogins,
    successLogins,

    activeSessions,
    sessionTokens: Math.max(1, sessionTokens),
    liveDevices: Math.max(1, liveDevices),

    ipAddress,
    device: deviceLabel,
    location,

    address: user.address || null,
    city: user.city || null,
    state: user.state || null,
    pincode: user.pincode || null,
    whatsappNumber: user.whatsappNumber || null,
    emergencyContactName: user.emergencyContactName || null,
    emergencyContactPhone: user.emergencyContactPhone || null,
    emergencyContactRelation: user.emergencyContactRelation || null,

    lastLogin: user.lastLogin || user.updatedAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function _extractDevice(ua) {
  if (!ua) return 'Unknown';
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad/i.test(ua)) return 'iOS';
  if (/Mac/i.test(ua)) return 'Mac';
  if (/Linux/i.test(ua)) return 'Linux';
  if (/Windows/i.test(ua)) return 'Windows';
  return 'Browser';
}

module.exports = { enrichUserForDashboard };
