const School = require('../models/School.js');
const { HTTP_STATUS, USER_ROLES } = require('../config/constants.js');

/**
 * Middleware to check if the user's school subscription is active
 * Blocks write operations (POST, PUT, PATCH, DELETE) for expired subscriptions
 * @param {boolean} allowReadOnly - If true, allows GET requests even for expired subscriptions
 */
const checkSubscriptionStatus = (allowReadOnly = false) => {
  return async (req, res, next) => {
    try {
      // SUPER_ADMIN bypasses subscription checks
      if (req.user?.role === USER_ROLES.SUPER_ADMIN) {
        return next();
      }

      // PARENT bypass (allow online payments even if subscription expired)
      if (req.user?.role === USER_ROLES.PARENT) {
        return next();
      }

      // Get schoolId from JWT token
      const schoolId = req.user?.schoolId;

      if (!schoolId) {
if (req.method === 'GET') {
return next();
}
return res.status(HTTP_STATUS.FORBIDDEN).json({
success: false,
message: 'School context missing'
});
}

      // Fetch school with subscription details
      const school = await School.findById(schoolId).select('subscription name code');

      if (!school) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          success: false,
          message: 'School not found'
        });
      }

      const now = new Date();
      const endDate = new Date(school.subscription.endDate);
      const gracePeriodEnd = new Date(endDate.getTime() + (school.subscription.gracePeriodDays * 24 * 60 * 60 * 1000));

      // Check if subscription is expired (past grace period)
      const isExpired = now > gracePeriodEnd;
      const isInGracePeriod = now > endDate && now <= gracePeriodEnd;

      // Update expired status if needed
      if (isExpired && !school.subscription.isExpired) {
        await School.findByIdAndUpdate(schoolId, {
          'subscription.isExpired': true
        });
      } else if (!isExpired && school.subscription.isExpired) {
        await School.findByIdAndUpdate(schoolId, {
          'subscription.isExpired': false
        });
      }

      // For read-only operations, allow if not expired or if allowReadOnly is true
      if (req.method === 'GET') {
        if (allowReadOnly || !isExpired) {
          // Add subscription info to request for UI display
          req.subscriptionStatus = {
            isExpired,
            isInGracePeriod,
            endDate: school.subscription.endDate,
            daysRemaining: isExpired ? 0 : Math.ceil((endDate - now) / (1000 * 60 * 60 * 24)),
            gracePeriodDays: school.subscription.gracePeriodDays
          };
          return next();
        }
      }

      // Block all write operations for expired subscriptions
      if (isExpired) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
          success: false,
          message: `Your subscription for school "${school.name}" has expired. Please renew your subscription to continue using write operations.`,
          subscriptionExpired: true,
          school: {
            name: school.name,
            code: school.code
          },
          subscription: {
            endDate: school.subscription.endDate,
            isExpired: true,
            gracePeriodDays: school.subscription.gracePeriodDays
          },
          contactSupport: true
        });
      }

      // Allow operations for active subscriptions or during grace period
      req.subscriptionStatus = {
        isExpired: false,
        isInGracePeriod,
        endDate: school.subscription.endDate,
        daysRemaining: Math.ceil((endDate - now) / (1000 * 60 * 60 * 24)),
        gracePeriodDays: school.subscription.gracePeriodDays
      };

      next();
    } catch (error) {
      console.error('Subscription check error:', error);
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Error checking subscription status'
      });
    }
  };
};

/**
 * Middleware specifically for blocking write operations on expired subscriptions
 * Use this for routes that should be completely blocked for expired schools
 */
const blockExpiredSubscription = (req, res, next) => {
  return checkSubscriptionStatus(false)(req, res, next);
};

/**
 * Middleware that allows read operations but blocks writes for expired subscriptions
 * Use this for routes where expired schools can still view data but not modify it
 */
const allowReadOnlyExpired = (req, res, next) => {
  return checkSubscriptionStatus(true)(req, res, next);
};

module.exports = {
  checkSubscriptionStatus,
  blockExpiredSubscription,
  allowReadOnlyExpired
};
