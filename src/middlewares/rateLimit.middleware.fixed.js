const { HTTP_STATUS } = require('../config/constants');
const { auditLog } = require('../utils/auditLog_new');

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
const createRateLimit = (maxRequests = 100, windowMs = 15 * 60 * 1000, limiterName = 'GENERAL') => {
  return (req, res, next) => {
    const key = `${req.user?._id || req.ip}-${limiterName}`;
    const now = Date.now();
    const windowStart = now - windowMs;

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

      const retryAfterSeconds = Math.ceil((userRequests.resetTime - now) / 1000);
      const retryAfterMinutes = Math.ceil(retryAfterSeconds / 60);

      res.set('Retry-After', retryAfterSeconds);

      return res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
        success: false,
        message: 'Too many requests. Please try again later.',
        retryAfter: retryAfterSeconds,
        retryAfterHuman: `${retryAfterMinutes} minute(s)`
      });
    }

    next();
  };
};

// Specific rate limits for different endpoints
const authRateLimit = createRateLimit(5, 15 * 60 * 1000, 'AUTH'); // 5 requests per 15 minutes for auth
const paymentRateLimit = createRateLimit(10, 60 * 60 * 1000, 'PAYMENT'); // 10 requests per hour for payments
const backupRateLimit = createRateLimit(3, 60 * 60 * 1000, 'BACKUP'); // 3 requests per hour for backup/restore
const generalRateLimit = createRateLimit(100, 15 * 60 * 1000, 'GENERAL'); // 100 requests per 15 minutes general

module.exports = {
  createRateLimit,
  authRateLimit,
  paymentRateLimit,
  backupRateLimit,
  generalRateLimit
};
