import School from '../models/School.js';
import { SCHOOL_MODULES } from '../config/constants.js';

/**
 * Middleware to check if a specific module is enabled for the user's school
 * @param {string} moduleName - The name of the module to check
 * @returns {Function} Express middleware function
 */
export const checkModuleAccess = (moduleName) => {
  return async (req, res, next) => {
    try {
      // Get schoolId from JWT token (assuming it's set by auth middleware)
      const schoolId = req.user?.schoolId;

      if (!schoolId) {
        return res.status(401).json({
          success: false,
          message: 'School ID not found in token'
        });
      }

      // Validate module name
      if (!SCHOOL_MODULES[moduleName]) {
        return res.status(400).json({
          success: false,
          message: `Invalid module name: ${moduleName}`
        });
      }

      // Fetch school document
      const school = await School.findById(schoolId).select('modules name');

      if (!school) {
        return res.status(404).json({
          success: false,
          message: 'School not found'
        });
      }

      // Check if module is enabled
      const isEnabled = school.modules?.[moduleName] ?? true; // Default to true if not set

      if (!isEnabled) {
        return res.status(403).json({
          success: false,
          message: `Module '${moduleName}' is disabled for school '${school.name}'. Please contact your administrator to enable this module.`,
          module: moduleName,
          school: school.name
        });
      }

      // Module is enabled, continue
      next();
    } catch (error) {
      console.error('Module access check error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error during module access check'
      });
    }
  };
};

/**
 * Middleware to check multiple modules (OR condition - at least one must be enabled)
 * @param {string[]} moduleNames - Array of module names to check
 * @returns {Function} Express middleware function
 */
export const checkAnyModuleAccess = (moduleNames) => {
  return async (req, res, next) => {
    try {
      const schoolId = req.user?.schoolId;

      if (!schoolId) {
        return res.status(401).json({
          success: false,
          message: 'School ID not found in token'
        });
      }

      const school = await School.findById(schoolId).select('modules name');

      if (!school) {
        return res.status(404).json({
          success: false,
          message: 'School not found'
        });
      }

      // Check if at least one module is enabled
      const enabledModules = moduleNames.filter(moduleName =>
        school.modules?.[moduleName] ?? true
      );

      if (enabledModules.length === 0) {
        return res.status(403).json({
          success: false,
          message: `None of the required modules (${moduleNames.join(', ')}) are enabled for school '${school.name}'. Please contact your administrator to enable at least one of these modules.`,
          modules: moduleNames,
          school: school.name
        });
      }

      // At least one module is enabled, continue
      next();
    } catch (error) {
      console.error('Multiple module access check error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error during module access check'
      });
    }
  };
};

/**
 * Middleware to check if all specified modules are enabled (AND condition)
 * @param {string[]} moduleNames - Array of module names that must all be enabled
 * @returns {Function} Express middleware function
 */
export const checkAllModulesAccess = (moduleNames) => {
  return async (req, res, next) => {
    try {
      const schoolId = req.user?.schoolId;

      if (!schoolId) {
        return res.status(401).json({
          success: false,
          message: 'School ID not found in token'
        });
      }

      const school = await School.findById(schoolId).select('modules name');

      if (!school) {
        return res.status(404).json({
          success: false,
          message: 'School not found'
        });
      }

      // Check if all modules are enabled
      const disabledModules = moduleNames.filter(moduleName =>
        !(school.modules?.[moduleName] ?? true)
      );

      if (disabledModules.length > 0) {
        return res.status(403).json({
          success: false,
          message: `The following modules are disabled for school '${school.name}': ${disabledModules.join(', ')}. Please contact your administrator to enable these modules.`,
          disabledModules,
          school: school.name
        });
      }

      // All modules are enabled, continue
      next();
    } catch (error) {
      console.error('All modules access check error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error during module access check'
      });
    }
  };
};
