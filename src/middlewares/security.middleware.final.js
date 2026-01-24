const { HTTP_STATUS, USER_ROLES } = require('../config/constants');
const { enforceSchoolIsolation } = require('./school.middleware');

/**
 * Sanitize response data - remove sensitive fields
 */
const sanitizeResponse = (req, res, next) => {
  const originalJson = res.json;

  res.json = function(data) {
    // Deep clone to avoid modifying original data
    const sanitizedData = JSON.parse(JSON.stringify(data));

    // Remove sensitive fields from user data
    const sanitizeObject = (obj) => {
      if (Array.isArray(obj)) {
        return obj.map(sanitizeObject);
      } else if (obj && typeof obj === 'object') {
        const sanitized = {};
        for (const [key, value] of Object.entries(obj)) {
          // Remove sensitive fields
          if (['password', 'resetToken', 'verificationToken', 'salt'].includes(key)) {
            continue;
          }
          // Recursively sanitize nested objects
          sanitized[key] = sanitizeObject(value);
        }
        return sanitized;
      }
      return obj;
    };

    return originalJson.call(this, sanitizeObject(sanitizedData));
  };

  next();
};

/**
 * Security headers middleware
 */
const securityHeaders = (req, res, next) => {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');

  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Enable XSS protection
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Content Security Policy (basic)
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'");

  next();
};

/**
 * Validate file uploads for security
 */
const validateFileUpload = (allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'], maxSize = 5 * 1024 * 1024) => {
  return (req, res, next) => {
    if (!req.file) {
      return next();
    }

    // Check file type
    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: `Invalid file type. Allowed types: ${allowedTypes.join(', ')}`
      });
    }

    // Check file size
    if (req.file.size > maxSize) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: `File too large. Maximum size: ${maxSize / (1024 * 1024)}MB`
      });
    }

    // Additional security checks
    const filename = req.file.originalname;
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Invalid filename'
      });
    }

    next();
  };
};

/**
 * Production error handler - don't leak internal errors
 */
const productionErrorHandler = (err, req, res, next) => {
  // Log the full error for debugging
  console.error('Production Error:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    user: req.user?.userId
  });

  // Send generic error response
  res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
    success: false,
    message: 'Internal server error'
  });
};

module.exports = {
  enforceSchoolIsolation,
  sanitizeResponse,
  securityHeaders,
  validateFileUpload,
  productionErrorHandler
};
