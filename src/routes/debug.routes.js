const express = require('express');
const redis = require('../config/redis');
const User = require('../models/User');

const router = express.Router();

// Temporary recovery endpoint. Remove after one successful use.
router.get('/unblock-super-admin', async (req, res) => {
  try {
    const admins = await User.find({ role: 'SUPER_ADMIN' })
      .select('_id name email status isDeleted')
      .lean();

    const results = [];
    for (const admin of admins) {
      await redis.del(`blacklist:user:${admin._id}`).catch(() => {});
      await User.findByIdAndUpdate(admin._id, {
        $set: {
          status: 'active',
          isDeleted: false,
          deletedAt: null,
          deletedBy: null,
          deactivatedAt: null,
          deactivatedBy: null,
          lockedUntil: null,
          failedLogins: 0
        }
      }).catch(() => {});

      results.push({
        id: admin._id,
        name: admin.name,
        email: admin.email
      });
    }

    const keys = await redis.keys('blacklist:user:*').catch(() => []);
    if (keys.length > 0) {
      await Promise.all(keys.map((key) => redis.del(key).catch(() => 0)));
    }

    const ipKeys = await redis.keys('blocked:ip:*').catch(() => []);
    if (ipKeys.length > 0) {
      await Promise.all(ipKeys.map((key) => redis.del(key).catch(() => 0)));
    }

    const bfKeys = await redis.keys('bruteforce:*').catch(() => []);
    if (bfKeys.length > 0) {
      await Promise.all(bfKeys.map((key) => redis.del(key).catch(() => 0)));
    }

    return res.json({
      success: true,
      message: 'Super admin unblocked and all Redis locks cleared',
      admins: results,
      clearedBlacklists: keys.length,
      clearedIpBlocks: ipKeys.length,
      clearedBruteForce: bfKeys.length
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
