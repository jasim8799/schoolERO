const crypto = require('crypto');

function auditEnrichMiddleware() {
  return (req, res, next) => {
    req.requestId = `REQ-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    req.traceId = crypto.randomUUID();
    req.requestStart = Date.now();

    const ua = req.headers['user-agent'] || '';
    req.deviceInfo = _parseUserAgent(ua);

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '10.0.0.1';
    req.region = _regionFromIp(ip);
    const routePath = req.originalUrl?.split('?')[0] || req.path || '';
    req.sourceService = _serviceFromPath(routePath);

    const originalJson = res.json.bind(res);
    res.json = function patchedJson(body) {
      try {
        req.responseSize = JSON.stringify(body || {}).length;
      } catch (_) {
        req.responseSize = 0;
      }
      req.latencyMs = Date.now() - req.requestStart;
      req.statusCode = res.statusCode;
      return originalJson(body);
    };

    next();
  };
}

function _parseUserAgent(ua) {
  const browser = /Chrome/.test(ua)
    ? 'Chrome'
    : /Safari/.test(ua)
    ? 'Safari'
    : /Firefox/.test(ua)
    ? 'Firefox'
    : /Edg|Edge/.test(ua)
    ? 'Edge'
    : 'Unknown';

  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Mac/.test(ua)
    ? 'Mac'
    : /Linux/.test(ua)
    ? 'Linux'
    : /Android/.test(ua)
    ? 'Android'
    : /iPhone|iOS/.test(ua)
    ? 'iOS'
    : 'Unknown';

  const device = /Bot|bot|crawler/.test(ua)
    ? 'Bot/Unknown'
    : /Mobile|Android|iPhone/.test(ua)
    ? `Mobile/${os}`
    : `${browser}/${os}`;

  return { browser, os, device };
}

function _regionFromIp(ip) {
  if (/^10\.|^172\.(1[6-9]|2\d|3[01])\.|^192\.168\./.test(ip)) return 'Private VPC';
  const hash = ip.split('.').reduce((acc, n) => acc + parseInt(n || '0', 10), 0);
  const regions = ['MUM', 'DEL', 'BLR', 'SGP', 'DXB', 'LON', 'NYC'];
  return regions[Math.abs(hash) % regions.length];
}

function _serviceFromPath(path) {
  if (/\/auth/.test(path)) return 'Auth Service';
  if (/\/backup|\/restore/.test(path)) return 'Backup Service';
  if (/\/payments|\/fees|\/billing|\/subscription/.test(path)) return 'Payment Service';
  if (/\/audit/.test(path)) return 'Audit Service';
  if (/\/users/.test(path)) return 'Identity Service';
  if (/\/schools/.test(path)) return 'School Service';
  if (/\/queue|\/jobs/.test(path)) return 'Queue Worker';
  return 'API Gateway';
}

function _deriveSeverity(action) {
  const act = (action || '').toUpperCase();
  if (/CRITICAL|BREACH|INJECT|ATTACK|BLOCKED/.test(act)) return 'CRITICAL';
  if (/FAILED|INVALID|DENIED|UNAUTHORIZED|ERROR/.test(act)) return 'ERROR';
  if (/WARNING|EXPIRED|EXCEEDED|FORCE|OVERRIDE/.test(act)) return 'WARNING';
  return 'INFO';
}

function _deriveCategory(action, entityType) {
  const act = (action || '').toUpperCase();
  const ent = (entityType || '').toUpperCase();

  if (/LOGIN|AUTH|TOKEN|MFA|PASSWORD/.test(act)) return 'Auth';
  if (/BACKUP|RESTORE/.test(act)) return 'Backup';
  if (/PAYMENT|FEE|BILLING|INVOICE|SALARY/.test(act)) return 'Compliance';
  if (/FIREWALL|BLOCK|RATE|LIMIT/.test(act)) return 'Firewall';
  if (/DB|DATABASE|MONGO|QUERY/.test(act) || ent === 'DATABASE') return 'Database';
  if (/CRITICAL|BREACH|SUSPICIOUS|ATTACK/.test(act)) return 'Security';
  if (/API|ENDPOINT|REQUEST/.test(act)) return 'API';
  return 'System';
}

function _deriveRiskScore(severity) {
  if (severity === 'CRITICAL') return 0.85;
  if (severity === 'ERROR') return 0.62;
  if (severity === 'WARNING') return 0.38;
  return 0.12;
}

function buildEnrichedAuditPayload(params, req) {
  const { browser, os, device } = req?.deviceInfo || {};
  const severity = _deriveSeverity(params.action);
  const category = _deriveCategory(params.action, params.entityType);
  const riskScore = _deriveRiskScore(severity);
  const endpoint = req?.originalUrl?.split('?')[0] || null;
  const payloadSize = (() => {
    try {
      return req?.body ? JSON.stringify(req.body).length : 0;
    } catch (_) {
      return 0;
    }
  })();

  return {
    ...params,
    severity,
    category,
    requestId: req?.requestId,
    traceId: req?.traceId,
    endpoint,
    method: req?.method,
    statusCode: req?.statusCode || 200,
    latencyMs: req?.latencyMs || 0,
    responseSize: req?.responseSize || 0,
    payloadSize,
    region: req?.region || 'MUM',
    browser,
    os,
    device,
    riskScore,
    aiThreatScore: Math.min(1, riskScore * 0.9),
    anomalyScore: 0,
    isSuspicious: riskScore > 0.6,
    isBlocked: false,
    sourceService: req?.sourceService || 'System',
    serverNode: require('os').hostname(),
    environment: process.env.NODE_ENV === 'production' ? 'PROD' : process.env.NODE_ENV === 'staging' ? 'STAGING' : 'DEV',
    message: params.description || params.action?.replace(/_/g, ' '),
    ipAddress:
      params.ipAddress ||
      req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
      req?.ip ||
      req?.connection?.remoteAddress ||
      '10.0.0.1',
  };
}

module.exports = { auditEnrichMiddleware, buildEnrichedAuditPayload };
