const mongoose = require('mongoose');
const redis = require('../../config/redis');
const { logger } = require('./logger');

/**
 * Validate if a string is a valid MongoDB ObjectId
 * @param {string} id - The ID to validate
 * @returns {boolean}
 */
const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id);
};

/**
 * Validate if a date string is valid and can be parsed
 * @param {string|Date} dateValue - Date string or Date object
 * @returns {boolean}
 */
const isValidDate = (dateValue) => {
  if (!dateValue) return false;
  const date = new Date(dateValue);
  return !isNaN(date.getTime());
};

/**
 * Validate date range (start before end)
 * @param {string|Date} startDate - Start date
 * @param {string|Date} endDate - End date
 * @returns {{valid: boolean, message: string}}
 */
const validateDateRange = (startDate, endDate) => {
  if (!isValidDate(startDate)) {
    return { valid: false, message: 'Start date is invalid' };
  }
  if (!isValidDate(endDate)) {
    return { valid: false, message: 'End date is invalid' };
  }
  
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  if (start >= end) {
    return { valid: false, message: 'End date must be after start date' };
  }
  
  return { valid: true, message: '' };
};

/**
 * Delete keys by pattern using SCAN for production safety
 * Non-blocking, scalable implementation
 * @param {string} pattern - Redis key pattern (e.g., "sessions:123:*")
 * @param {number} batchSize - Number of keys to delete per batch (default 1000)
 * @returns {Promise<number>} - Number of keys deleted
 */
const deleteKeysByPattern = async (pattern, batchSize = 1000) => {
  try {
    let cursor = '0';
    let deletedCount = 0;

    do {
      const reply = await redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        batchSize
      );

      cursor = reply[0];
      const keys = reply[1] || [];

      if (keys.length > 0) {
        await redis.del(...keys);
        deletedCount += keys.length;
      }
    } while (cursor !== '0');

    return deletedCount;
  } catch (error) {
    logger.warn(`[SESSION_CACHE] deleteKeysByPattern failed for pattern=${pattern}: ${error.message}`);
    return 0;
  }
};

/**
 * Invalidate session-related caches using production-safe SCAN
 * @param {string} schoolId - School ID
 * @returns {Promise<void>}
 */
const invalidateSessionCachesProduction = async (schoolId) => {
  try {
    const patterns = [
      `sessions:${schoolId}:*`,
      `school:${schoolId}:session:*`,
      `permissions:${schoolId}:*`,
      `modules:${schoolId}:*`,
      `layout:nav:${schoolId}:*`,
    ];

    const results = await Promise.allSettled(
      patterns.map(p => deleteKeysByPattern(p))
    );

    const totalDeleted = results
      .filter(r => r.status === 'fulfilled')
      .reduce((sum, r) => sum + r.value, 0);

    if (totalDeleted > 0) {
      logger.info(`[SESSION_CACHE] Invalidated ${totalDeleted} cache keys for schoolId=${schoolId}`);
    }
  } catch (error) {
    logger.warn(`[SESSION_CACHE] invalidateSessionCachesProduction error: ${error.message}`);
  }
};

module.exports = {
  isValidObjectId,
  isValidDate,
  validateDateRange,
  deleteKeysByPattern,
  invalidateSessionCachesProduction,
};
