const School = require('../models/School.js');
const { checkModuleAccess } = require('./moduleAccess.middleware.js');

/**
 * Middleware to check if online payments are available for the user's school
 * Checks both plan-based module access and admin toggle
 */
const checkOnlinePaymentAccess = async (req, res, next) => {
  try {
    const schoolId = req.user?.schoolId;

    if (!schoolId) {
      return res.status(400).json({
        success: false,
        message: 'School ID is required'
      });
    }

    // Get school with plan, modules, and onlinePaymentsEnabled
    const school = await School.findById(schoolId).select('plan modules onlinePaymentsEnabled name code');
    if (!school) {
      return res.status(404).json({
        success: false,
        message: 'School not found'
      });
    }

    // Check if online payments module is enabled for the plan
    const planAllowsOnlinePayments = school.modules?.online_payments ?? false;

    // Check if admin has enabled online payments
    const adminEnabledOnlinePayments = school.onlinePaymentsEnabled ?? true;

    // Online payments are available only if both conditions are met
    const onlinePaymentsAvailable = planAllowsOnlinePayments && adminEnabledOnlinePayments;

    if (!onlinePaymentsAvailable) {
      let reason = '';
      if (!planAllowsOnlinePayments && !adminEnabledOnlinePayments) {
        reason = 'Online payments are not available for your current plan and have been disabled by your administrator.';
      } else if (!planAllowsOnlinePayments) {
        reason = 'Online payments are not available for your current plan. Please upgrade your plan to enable online payments.';
      } else if (!adminEnabledOnlinePayments) {
        reason = 'Online payments have been disabled by your school administrator.';
      }

      return res.status(403).json({
        success: false,
        message: `Online payments are not available. ${reason}`,
        error: {
          type: 'ONLINE_PAYMENTS_DISABLED',
          planAllows: planAllowsOnlinePayments,
          adminEnabled: adminEnabledOnlinePayments,
          currentPlan: school.plan,
          school: school.name
        }
      });
    }

    // Online payments are available, continue
    next();
  } catch (error) {
    console.error('Online payment access check error:', error);
    res.status(500).json({
      success: false,
      message: 'Error checking online payment availability',
      error: error.message
    });
  }
};

module.exports = { checkOnlinePaymentAccess };
