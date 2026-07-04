const { HTTP_STATUS } = require('../config/constants');
const { auditLog } = require('../utils/auditLog');
const { recordSecurityEvent } = require('../services/security.metrics');

// Simple in-memory rate limiting (for production, use Redis or similar)
const rateLimitStore = new Map();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of rateLimitStore.entries()) {
    if (now > data.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

// Rate limiting middleware
const _isAuthLoginPath = (req) => {
  const path = req.path || '';
  const url = req.originalUrl || '';
  return (
    path === '/login' ||
    path.endsWith('/auth/login') ||
    /\/auth\/login(\?|$)/i.test(url)
  );
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createRateLimit = (
  maxRequests = 100,
  windowMs = 15 * 60 * 1000,
  limiterName = 'GENERAL',
  options = {}
) => {
  const {
    keyResolver,
    skip,
    responseMessage = 'Too many requests. Please try again later.',
    delayAfterLimitMs = 0,
  } = options;

  return async (req, res, next) => {
    if (typeof skip === 'function' && skip(req)) {
      return next();
    }

    const key = typeof keyResolver === 'function'
      ? keyResolver(req)
      : `${req.user?._id || req.ip}-${limiterName}`;
    const now = Date.now();

    let userRequests = rateLimitStore.get(key);

    if (!userRequests) {
      userRequests = { count: 0, resetTime: now + windowMs };
      rateLimitStore.set(key, userRequests);
    }

    // Reset if window has passed
    if (now > userRequests.resetTime) {
      userRequests.count = 0;
      userRequests.resetTime = now + windowMs;
    }

    userRequests.count++;

    // Set headers
    res.set({
      'X-RateLimit-Limit': maxRequests,
      'X-RateLimit-Remaining': Math.max(0, maxRequests - userRequests.count),
      'X-RateLimit-Reset': new Date(userRequests.resetTime).toISOString()
    });

    if (userRequests.count > maxRequests) {
      console.warn(`[RATE_LIMIT] Limiter ${limiterName} exceeded for ${req.ip} on ${req.originalUrl}`);
      // Audit log the rate limit hit (fire-and-forget)
      auditLog({
        action: 'RATE_LIMIT_EXCEEDED',
        userId: req.user?._id ?? null,
        role: req.user?.role ?? 'GUEST',
        entityType: 'RATE_LIMIT',
        entityId: null,
        description: `Rate limit exceeded on ${req.originalUrl} (${limiterName})`,
        ipAddress: req.ip,
        schoolId: req.user?.schoolId ?? null,
        sessionId: req.user?.sessionId ?? null,
        req
      }).catch(() => {});

      recordSecurityEvent('RATE_LIMIT_EXCEEDED', {
        ipAddress: req.ip,
        severity: 'HIGH',
      }).catch(() => {});

      const retryAfterSeconds = Math.ceil((userRequests.resetTime - now) / 1000);
      const retryAfterMinutes = Math.ceil(retryAfterSeconds / 60);

      if (delayAfterLimitMs > 0) {
        await wait(delayAfterLimitMs);
      }

      res.set('Retry-After', retryAfterSeconds);

      return res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
        success: false,
        message: responseMessage,
        retryAfter: retryAfterSeconds,
        retryAfterHuman: `${retryAfterMinutes} minute(s)`
      });
    }

    next();
  };
};

// Specific rate limits for different endpoints
// NOTE: Login does NOT have a rate limiter — per-account lockout is handled by
// accountSecurity.service.js which prevents collateral damage to other users.
// Global rate limits on login would block all school network users when one user fails.

// Strict auth limiter for brute-force protection on public login endpoints.
const authRateLimit = createRateLimit(5, 15 * 60 * 1000, 'AUTH_PUBLIC', {
  keyResolver: (req) => `${req.ip}-AUTH_PUBLIC`,
  responseMessage: 'Invalid email or password',
  delayAfterLimitMs: 400,
});

const loginRateLimit = createRateLimit(5, 15 * 60 * 1000, 'AUTH_LOGIN', {
  keyResolver: (req) => `${req.ip}-AUTH_LOGIN`,
  responseMessage: 'Invalid email or password',
  delayAfterLimitMs: 400,
});

const paymentRateLimit = (req, res, next) => next();
const backupRateLimit = (req, res, next) => next();
const generalRateLimit = (req, res, next) => next();

module.exports = {
  createRateLimit,
  authRateLimit,
  loginRateLimit,
  paymentRateLimit,
  backupRateLimit,
  generalRateLimit
};
