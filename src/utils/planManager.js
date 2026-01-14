import { PLAN_CONFIGS } from '../config/constants.js';

/**
 * Get plan configuration by plan name
 * @param {string} planName - The plan name (BASIC, STANDARD, PREMIUM)
 * @returns {Object} Plan configuration object
 */
export const getPlanConfig = (planName) => {
  return PLAN_CONFIGS[planName] || PLAN_CONFIGS.BASIC;
};

/**
 * Apply plan configuration to school data
 * @param {Object} schoolData - School data object
 * @param {string} planName - The plan name
 * @returns {Object} Updated school data with plan-specific modules and limits
 */
export const applyPlanToSchool = (schoolData, planName) => {
  const planConfig = getPlanConfig(planName);

  return {
    ...schoolData,
    plan: planName,
    limits: {
      ...schoolData.limits,
      ...planConfig.limits
    },
    modules: {
      ...schoolData.modules,
      ...planConfig.modules
    }
  };
};

/**
 * Get all available plans
 * @returns {Array} Array of plan objects with name, description, and features
 */
export const getAllPlans = () => {
  return Object.keys(PLAN_CONFIGS).map(planKey => ({
    id: planKey,
    ...PLAN_CONFIGS[planKey]
  }));
};

/**
 * Check if a module is enabled for a given plan
 * @param {string} planName - The plan name
 * @param {string} moduleName - The module name
 * @returns {boolean} Whether the module is enabled
 */
export const isModuleEnabledForPlan = (planName, moduleName) => {
  const planConfig = getPlanConfig(planName);
  return planConfig.modules[moduleName] || false;
};

/**
 * Get enabled modules for a plan
 * @param {string} planName - The plan name
 * @returns {Array} Array of enabled module names
 */
export const getEnabledModulesForPlan = (planName) => {
  const planConfig = getPlanConfig(planName);
  return Object.keys(planConfig.modules).filter(module => planConfig.modules[module]);
};
