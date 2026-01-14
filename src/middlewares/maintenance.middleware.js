import SystemSettings from '../models/SystemSettings.js';
import { USER_ROLES } from '../config/constants.js';

// Check if system is in maintenance mode
export const checkMaintenanceMode = async (req, res, next) => {
  try {
    // Get system settings
    let settings = await SystemSettings.findOne();
    if (!settings) {
      // Create default settings if none exist
      settings = await SystemSettings.create({});
    }

    // If maintenance mode is enabled
    if (settings.maintenanceMode) {
      // Allow SUPER_ADMIN to bypass
      if (req.user && req.user.role === USER_ROLES.SUPER_ADMIN) {
        return next();
      }

      // Block all other requests
      return res.status(503).json({
        success: false,
        message: settings.maintenanceMessage || 'System is currently under maintenance. Please try again later.',
        maintenance: true
      });
    }

    next();
  } catch (error) {
    // If there's an error checking maintenance mode, allow the request to proceed
    console.error('Maintenance mode check error:', error);
    next();
  }
};
