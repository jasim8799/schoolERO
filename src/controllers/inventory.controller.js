const Inventory = require('../models/Inventory.js');
const { HTTP_STATUS, USER_ROLES } = require('../config/constants.js');
const { logger } = require('../utils/logger.js');
const { auditLog } = require('../utils/auditLog.js');

// Export inventory data as JSON (Principal/Operator)
const exportInventoryController = async (req, res) => {
  try {
    const { role, schoolId } = req.user;

    // Allow only Principal and Operator
    if (![USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR].includes(role)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'Access denied. Principal or Operator only.'
      });
    }

    // Export only this user's school inventory
    const items = await Inventory.find({ schoolId }).lean();

    await auditLog({
      action: 'INVENTORY_EXPORTED',
      entityType: 'INVENTORY',
      userId: req.user.userId || req.user._id,
      role,
      schoolId,
      details: {
        totalItems: items.length,
      },
      req,
    });

    logger.success(`Inventory export prepared for school ${schoolId}: ${items.length} items`);

    return res.status(HTTP_STATUS.OK).json({
      success: true,
      data: items,
      total: items.length,
      schoolId,
      exportedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Export inventory error:', error.message);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error exporting inventory',
      error: error.message
    });
  }
};

module.exports = {
  exportInventoryController
};
