const School = require('../models/School.js');
const User = require('../models/User.js');
const { USER_ROLES, USER_STATUS, SAAS_PLANS, PLAN_CONFIGS } = require('../config/constants.js');
const { logger } = require('../utils/logger.js');

// Check student limit before creating students
const checkStudentLimit = async (req, res, next) => {
  try {
    const schoolId = req.user.schoolId;

    if (!schoolId) {
      return res.status(400).json({
        success: false,
        message: 'School ID is required'
      });
    }

    // Get school with limits and plan
    const school = await School.findById(schoolId).select('limits plan name code');
    if (!school) {
      return res.status(404).json({
        success: false,
        message: 'School not found'
      });
    }

    // Count current active students
    const currentStudentCount = await User.countDocuments({
      schoolId,
      role: USER_ROLES.STUDENT,
      status: USER_STATUS.ACTIVE
    });

    if (currentStudentCount >= school.limits.studentLimit) {
      // Find next available plan with higher student limit
      const upgradeSuggestion = getUpgradeSuggestion(school.plan, 'studentLimit');

      return res.status(403).json({
        success: false,
        message: `Student limit exceeded for ${school.plan} plan. Current: ${currentStudentCount}, Limit: ${school.limits.studentLimit}. ${upgradeSuggestion ? `Upgrade to ${upgradeSuggestion.plan} plan to increase limit to ${upgradeSuggestion.newLimit}.` : 'Contact administrator for custom limits.'}`,
        error: {
          type: 'LIMIT_EXCEEDED',
          limitType: 'students',
          current: currentStudentCount,
          limit: school.limits.studentLimit,
          currentPlan: school.plan
        },
        upgradeSuggestion
      });
    }

    // Add limit info to request for potential use
    req.schoolLimits = {
      students: {
        current: currentStudentCount,
        limit: school.limits.studentLimit
      }
    };

    next();
  } catch (error) {
    logger.error('Check student limit error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error checking student limit',
      error: error.message
    });
  }
};

// Check teacher limit before creating teachers
const checkTeacherLimit = async (req, res, next) => {
  try {
    const schoolId = req.user.schoolId;

    if (!schoolId) {
      return res.status(400).json({
        success: false,
        message: 'School ID is required'
      });
    }

    // Get school with limits and plan
    const school = await School.findById(schoolId).select('limits plan name code');
    if (!school) {
      return res.status(404).json({
        success: false,
        message: 'School not found'
      });
    }

    // Count current active teachers
    const currentTeacherCount = await User.countDocuments({
      schoolId,
      role: USER_ROLES.TEACHER,
      status: USER_STATUS.ACTIVE
    });

    if (currentTeacherCount >= school.limits.teacherLimit) {
      // Find next available plan with higher teacher limit
      const upgradeSuggestion = getUpgradeSuggestion(school.plan, 'teacherLimit');

      return res.status(403).json({
        success: false,
        message: `Teacher limit exceeded for ${school.plan} plan. Current: ${currentTeacherCount}, Limit: ${school.limits.teacherLimit}. ${upgradeSuggestion ? `Upgrade to ${upgradeSuggestion.plan} plan to increase limit to ${upgradeSuggestion.newLimit}.` : 'Contact administrator for custom limits.'}`,
        error: {
          type: 'LIMIT_EXCEEDED',
          limitType: 'teachers',
          current: currentTeacherCount,
          limit: school.limits.teacherLimit,
          currentPlan: school.plan
        },
        upgradeSuggestion
      });
    }

    // Add limit info to request for potential use
    req.schoolLimits = {
      ...req.schoolLimits,
      teachers: {
        current: currentTeacherCount,
        limit: school.limits.teacherLimit
      }
    };

    next();
  } catch (error) {
    logger.error('Check teacher limit error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error checking teacher limit',
      error: error.message
    });
  }
};

// Check storage limit (placeholder - would need actual storage tracking)
const checkStorageLimit = async (req, res, next) => {
  try {
    const schoolId = req.user.schoolId;

    if (!schoolId) {
      return res.status(400).json({
        success: false,
        message: 'School ID is required'
      });
    }

    // Get school with limits and plan
    const school = await School.findById(schoolId).select('limits plan name code');
    if (!school) {
      return res.status(404).json({
        success: false,
        message: 'School not found'
      });
    }

    // TODO: Implement actual storage usage calculation
    // For now, we'll use a placeholder - in a real implementation,
    // you'd calculate total storage used by files, backups, etc.
    const currentStorageUsage = 0; // Placeholder

    if (currentStorageUsage >= school.limits.storageLimit) {
      // Find next available plan with higher storage limit
      const upgradeSuggestion = getUpgradeSuggestion(school.plan, 'storageLimit');

      return res.status(403).json({
        success: false,
        message: `Storage limit exceeded for ${school.plan} plan. Current: ${formatBytes(currentStorageUsage)}, Limit: ${formatBytes(school.limits.storageLimit)}. ${upgradeSuggestion ? `Upgrade to ${upgradeSuggestion.plan} plan to increase limit to ${formatBytes(upgradeSuggestion.newLimit)}.` : 'Contact administrator for custom limits.'}`,
        error: {
          type: 'LIMIT_EXCEEDED',
          limitType: 'storage',
          current: currentStorageUsage,
          limit: school.limits.storageLimit,
          currentPlan: school.plan
        },
        upgradeSuggestion
      });
    }

    // Add limit info to request for potential use
    req.schoolLimits = {
      ...req.schoolLimits,
      storage: {
        current: currentStorageUsage,
        limit: school.limits.storageLimit
      }
    };

    next();
  } catch (error) {
    logger.error('Check storage limit error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error checking storage limit',
      error: error.message
    });
  }
};

// Helper function to get upgrade suggestion
const getUpgradeSuggestion = (currentPlan, limitType) => {
  const planHierarchy = [SAAS_PLANS.BASIC, SAAS_PLANS.STANDARD, SAAS_PLANS.PREMIUM];
  const currentIndex = planHierarchy.indexOf(currentPlan);

  if (currentIndex === -1) return null;

  // Check higher plans for better limits
  for (let i = currentIndex + 1; i < planHierarchy.length; i++) {
    const nextPlan = planHierarchy[i];
    const nextPlanConfig = PLAN_CONFIGS[nextPlan];

    if (nextPlanConfig.limits[limitType] > PLAN_CONFIGS[currentPlan].limits[limitType]) {
      return {
        plan: nextPlan,
        newLimit: nextPlanConfig.limits[limitType],
        description: nextPlanConfig.description
      };
    }
  }

  return null; // No upgrade available
};

// Helper function to format bytes
const formatBytes = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

module.exports = {
  checkStudentLimit,
  checkTeacherLimit,
  checkStorageLimit
};
