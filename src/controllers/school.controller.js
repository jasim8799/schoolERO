import mongoose from 'mongoose';
import School from '../models/School.js';
import User from '../models/User.js';
import AcademicSession from '../models/AcademicSession.js';
import { HTTP_STATUS, USER_ROLES, SCHOOL_MODULES, SAAS_PLANS } from '../config/constants.js';
import { logger } from '../utils/logger.js';
import { auditLog } from '../utils/auditLog_new.js';
import { applyPlanToSchool, getPlanConfig } from '../utils/planManager.js';
import bcrypt from 'bcrypt';

// Create School
export const createSchool = async (req, res) => {
  try {
    const { name, code, address, contact, plan } = req.body;

    // Validate required fields
    if (!name || !code) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'School name and code are required'
      });
    }

    // Validate plan if provided
    if (plan && !Object.values(SAAS_PLANS).includes(plan)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Invalid plan specified'
      });
    }

    // Check if school code already exists
    const existingSchool = await School.findOne({ code: code.toUpperCase() });
    if (existingSchool) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'School code already exists'
      });
    }

    // Prepare school data
    const schoolData = {
      name,
      code: code.toUpperCase(),
      address,
      contact,
      plan: plan || SAAS_PLANS.BASIC // Default to BASIC if not specified
    };

    // Apply plan configuration
    const schoolDataWithPlan = applyPlanToSchool(schoolData, schoolData.plan);

    // Create school
    const school = await School.create(schoolDataWithPlan);

    logger.success(`School created: ${school.name} (${school.code}) with plan: ${school.plan}`);

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: 'School created successfully',
      data: school
    });
  } catch (error) {
    logger.error('Create school error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error creating school',
      error: error.message
    });
  }
};

// Get School Limits
export const getSchoolLimits = async (req, res) => {
  try {
    const { id } = req.params;

    const school = await School.findById(id).select('limits name code');
    if (!school) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'School not found'
      });
    }

    // Get current usage counts
    const [studentCount, teacherCount] = await Promise.all([
      User.countDocuments({
        schoolId: id,
        role: USER_ROLES.STUDENT,
        status: USER_STATUS.ACTIVE
      }),
      User.countDocuments({
        schoolId: id,
        role: USER_ROLES.TEACHER,
        status: USER_STATUS.ACTIVE
      })
    ]);

    // TODO: Calculate actual storage usage
    const storageUsage = 0; // Placeholder

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: {
        school: {
          id: school._id,
          name: school.name,
          code: school.code
        },
        limits: school.limits,
        usage: {
          students: studentCount,
          teachers: teacherCount,
          storage: storageUsage
        }
      }
    });
  } catch (error) {
    logger.error('Get school limits error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error fetching school limits',
      error: error.message
    });
  }
};

// Update School Limits
export const updateSchoolLimits = async (req, res) => {
  try {
    const { id } = req.params;
    const { studentLimit, teacherLimit, storageLimit } = req.body;

    // Validate limits
    if (studentLimit !== undefined && (studentLimit < 1 || studentLimit > 10000)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Student limit must be between 1 and 10000'
      });
    }

    if (teacherLimit !== undefined && (teacherLimit < 1 || teacherLimit > 1000)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Teacher limit must be between 1 and 1000'
      });
    }

    if (storageLimit !== undefined && (storageLimit < 1048576 || storageLimit > 107374182400)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Storage limit must be between 1MB and 100GB'
      });
    }

    const updateData = {};
    if (studentLimit !== undefined) updateData['limits.studentLimit'] = studentLimit;
    if (teacherLimit !== undefined) updateData['limits.teacherLimit'] = teacherLimit;
    if (storageLimit !== undefined) updateData['limits.storageLimit'] = storageLimit;

    const school = await School.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).select('limits name code');

    if (!school) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'School not found'
      });
    }

    // Log the limit update
    await auditLog({
      action: 'SCHOOL_LIMITS_UPDATED',
      userId: req.user._id,
      role: req.user.role,
      entityType: 'School',
      entityId: school._id,
      description: `Updated limits for school "${school.name}" (${school.code})`,
      details: {
        schoolName: school.name,
        schoolCode: school.code,
        oldLimits: {}, // Would need to fetch old values
        newLimits: school.limits
      },
      req
    });

    logger.success(`School limits updated: ${school.name} (${school.code})`);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'School limits updated successfully',
      data: school
    });
  } catch (error) {
    logger.error('Update school limits error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error updating school limits',
      error: error.message
    });
  }
};

// Get All Schools
export const getAllSchools = async (req, res) => {
  try {
    const schools = await School.find().sort({ createdAt: -1 });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      count: schools.length,
      data: schools
    });
  } catch (error) {
    logger.error('Get schools error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error fetching schools',
      error: error.message
    });
  }
};

// Get School by ID
export const getSchoolById = async (req, res) => {
  try {
    const school = await School.findById(req.params.id);

    if (!school) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'School not found'
      });
    }

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: school
    });
  } catch (error) {
    logger.error('Get school error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error fetching school',
      error: error.message
    });
  }
};

// Create School with Lifecycle (Super Admin only)
export const createSchoolWithLifecycle = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      name,
      code,
      address,
      contact,
      plan,
      principalName,
      principalEmail,
      principalMobile,
      principalPassword
    } = req.body;

    // Validate required fields
    if (!name || !code) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'School name and code are required'
      });
    }

    // Validate plan if provided
    if (plan && !Object.values(SAAS_PLANS).includes(plan)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Invalid plan specified'
      });
    }

    // Check if school code already exists
    const existingSchool = await School.findOne({ code: code.toUpperCase() });
    if (existingSchool) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'School code already exists'
      });
    }

    // Generate unique school code if not provided or ensure uniqueness
    let schoolCode = code.toUpperCase();
    let codeExists = await School.findOne({ code: schoolCode });
    let counter = 1;
    while (codeExists) {
      schoolCode = `${code.toUpperCase()}${counter}`;
      codeExists = await School.findOne({ code: schoolCode });
      counter++;
    }

    // Prepare school data
    const schoolData = {
      name,
      code: schoolCode,
      address,
      contact,
      plan: plan || SAAS_PLANS.BASIC // Default to BASIC if not specified
    };

    // Apply plan configuration
    const schoolDataWithPlan = applyPlanToSchool(schoolData, schoolData.plan);

    // 1. Create school
    const school = await School.create([schoolDataWithPlan], { session });

    // 2. Create or assign Principal
    let principal;
    if (principalEmail) {
      // Check if principal with this email already exists
      principal = await User.findOne({ email: principalEmail.toLowerCase() });
      if (principal) {
        // Update existing user to be principal of this school
        principal.role = USER_ROLES.PRINCIPAL;
        principal.schoolId = school[0]._id;
        if (principalPassword) {
          principal.password = await bcrypt.hash(principalPassword, 12);
        }
        await principal.save({ session });
      } else {
        // Create new principal
        const hashedPassword = await bcrypt.hash(principalPassword || 'TempPass123!', 12);
        principal = await User.create([{
          name: principalName,
          email: principalEmail.toLowerCase(),
          mobile: principalMobile,
          password: hashedPassword,
          role: USER_ROLES.PRINCIPAL,
          schoolId: school[0]._id
        }], { session });
      }
    }

    // 3. Apply default plan & limits (create default academic session)
    const currentYear = new Date().getFullYear();
    const defaultSession = await AcademicSession.create([{
      name: `${currentYear}-${currentYear + 1}`,
      startDate: new Date(currentYear, 3, 1), // April 1st
      endDate: new Date(currentYear + 1, 2, 31), // March 31st
      schoolId: school[0]._id,
      isActive: true
    }], { session });

    // 4. Log creation action
    await auditLog({
      action: 'SCHOOL_LIFECYCLE_CREATED',
      userId: req.user._id,
      role: req.user.role,
      entityType: 'School',
      entityId: school[0]._id,
      description: `Created school "${school[0].name}" (${school[0].code}) with lifecycle setup`,
      details: {
        schoolName: school[0].name,
        schoolCode: school[0].code,
        principalCreated: !!principal,
        principalEmail: principalEmail,
        defaultSessionCreated: true,
        sessionName: defaultSession[0].name
      },
      req
    });

    await session.commitTransaction();

    logger.success(`School lifecycle created: ${school[0].name} (${school[0].code})`);

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: 'School created successfully with lifecycle setup',
      data: {
        school: school[0],
        principal: principal ? principal[0] : null,
        defaultSession: defaultSession[0]
      }
    });
  } catch (error) {
    await session.abortTransaction();
    logger.error('Create school lifecycle error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error creating school with lifecycle',
      error: error.message
    });
  } finally {
    session.endSession();
  }
};

// Activate/Deactivate School
export const toggleSchoolStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // Validate status
    if (!status || !['active', 'inactive'].includes(status)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Invalid status. Must be "active" or "inactive"'
      });
    }

    // Find and update school
    const school = await School.findByIdAndUpdate(
      id,
      { status },
      { new: true, runValidators: true }
    );

    if (!school) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'School not found'
      });
    }

    // Log the status change
    await auditLog({
      action: status === 'active' ? 'SCHOOL_ACTIVATED' : 'SCHOOL_DEACTIVATED',
      userId: req.user._id,
      role: req.user.role,
      entityType: 'School',
      entityId: school._id,
      description: `School "${school.name}" (${school.code}) ${status === 'active' ? 'activated' : 'deactivated'}`,
      details: {
        schoolName: school.name,
        schoolCode: school.code,
        previousStatus: school.status === 'active' ? 'inactive' : 'active',
        newStatus: status
      },
      req
    });

    logger.success(`School ${status}: ${school.name} (${school.code})`);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: `School ${status === 'active' ? 'activated' : 'deactivated'} successfully`,
      data: school
    });
  } catch (error) {
    logger.error('Toggle school status error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error updating school status',
      error: error.message
    });
  }
};

// Reassign Principal
export const reassignPrincipal = async (req, res) => {
  try {
    const { id } = req.params;
    const { newPrincipalId } = req.body;

    // Validate required fields
    if (!newPrincipalId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'New principal ID is required'
      });
    }

    // Find the school
    const school = await School.findById(id);
    if (!school) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'School not found'
      });
    }

    // Find the new principal
    const newPrincipal = await User.findById(newPrincipalId);
    if (!newPrincipal) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'New principal not found'
      });
    }

    // Check if new principal is already a principal somewhere else
    if (newPrincipal.role === USER_ROLES.PRINCIPAL && newPrincipal.schoolId && newPrincipal.schoolId.toString() !== id) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Selected user is already a principal at another school'
      });
    }

    // Find current principal
    const currentPrincipal = await User.findOne({
      role: USER_ROLES.PRINCIPAL,
      schoolId: id,
      status: USER_STATUS.ACTIVE
    });

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Revoke old principal's access
      if (currentPrincipal) {
        await User.findByIdAndUpdate(
          currentPrincipal._id,
          {
            role: 'FORMER_PRINCIPAL', // Change role to prevent access
            status: USER_STATUS.INACTIVE,
            deactivatedAt: new Date(),
            deactivatedBy: req.user._id
          },
          { session }
        );
      }

      // Assign new principal
      await User.findByIdAndUpdate(
        newPrincipalId,
        {
          role: USER_ROLES.PRINCIPAL,
          schoolId: id,
          status: USER_STATUS.ACTIVE,
          deactivatedAt: null,
          deactivatedBy: null
        },
        { session }
      );

      // Log the reassignment
      await auditLog({
        action: 'PRINCIPAL_REASSIGNED',
        userId: req.user._id,
        role: req.user.role,
        entityType: 'School',
        entityId: school._id,
        description: `Principal reassigned for school "${school.name}" (${school.code})`,
        details: {
          schoolName: school.name,
          schoolCode: school.code,
          oldPrincipalId: currentPrincipal?._id,
          oldPrincipalName: currentPrincipal?.name,
          newPrincipalId: newPrincipal._id,
          newPrincipalName: newPrincipal.name
        },
        req
      });

      await session.commitTransaction();

      logger.success(`Principal reassigned for school: ${school.name} (${school.code})`);

      res.status(HTTP_STATUS.OK).json({
        success: true,
        message: 'Principal reassigned successfully',
        data: {
          school,
          oldPrincipal: currentPrincipal,
          newPrincipal
        }
      });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  } catch (error) {
    logger.error('Reassign principal error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error reassigning principal',
      error: error.message
    });
  }
};

// Get Current User's School Modules
export const getCurrentUserSchoolModules = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;

    if (!schoolId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'School ID not found in user token'
      });
    }

    const school = await School.findById(schoolId).select('modules name code plan');
    if (!school) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'School not found'
      });
    }

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: {
        school: {
          id: school._id,
          name: school.name,
          code: school.code,
          plan: school.plan
        },
        modules: school.modules
      }
    });
  } catch (error) {
    logger.error('Get current user school modules error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error fetching school modules',
      error: error.message
    });
  }
};

// Get Current User's School Online Payment Status
export const getCurrentUserSchoolOnlinePayments = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;

    if (!schoolId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'School ID not found in user token'
      });
    }

    const school = await School.findById(schoolId).select('modules onlinePaymentsEnabled name code plan');
    if (!school) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'School not found'
      });
    }

    // Check plan-based availability
    const planAllowsOnlinePayments = school.modules?.online_payments ?? false;

    // Check admin toggle
    const adminEnabledOnlinePayments = school.onlinePaymentsEnabled ?? true;

    // Online payments are available only if both conditions are met
    const available = planAllowsOnlinePayments && adminEnabledOnlinePayments;

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: {
        available,
        planAllows: planAllowsOnlinePayments,
        adminEnabled: adminEnabledOnlinePayments,
        school: {
          id: school._id,
          name: school.name,
          code: school.code,
          plan: school.plan
        }
      }
    });
  } catch (error) {
    logger.error('Get current user school online payments error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error fetching online payment status',
      error: error.message
    });
  }
};

// Get School Modules
export const getSchoolModules = async (req, res) => {
  try {
    const { id } = req.params;

    const school = await School.findById(id).select('modules name code');
    if (!school) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'School not found'
      });
    }

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: {
        school: {
          id: school._id,
          name: school.name,
          code: school.code
        },
        modules: school.modules
      }
    });
  } catch (error) {
    logger.error('Get school modules error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error fetching school modules',
      error: error.message
    });
  }
};

// Update School Plan
export const updateSchoolPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const { plan, confirmed } = req.body;

    // Validate plan
    if (!plan || !Object.values(SAAS_PLANS).includes(plan)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Valid plan is required (BASIC, STANDARD, PREMIUM)'
      });
    }

    // Get current school
    const currentSchool = await School.findById(id).select('plan modules limits name code');
    if (!currentSchool) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'School not found'
      });
    }

    // Check if plan is actually changing
    if (currentSchool.plan === plan) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: `School is already on ${plan} plan`
      });
    }

    // Check if this is a downgrade (requires confirmation)
    const planHierarchy = { [SAAS_PLANS.BASIC]: 1, [SAAS_PLANS.STANDARD]: 2, [SAAS_PLANS.PREMIUM]: 3 };
    const isDowngrade = planHierarchy[plan] < planHierarchy[currentSchool.plan];

    if (isDowngrade && !confirmed) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: `Plan downgrade requires confirmation. Current plan: ${currentSchool.plan}, New plan: ${plan}. Please confirm this action.`,
        requiresConfirmation: true,
        currentPlan: currentSchool.plan,
        newPlan: plan,
        isDowngrade: true
      });
    }

    // Get new plan configuration
    const newPlanConfig = getPlanConfig(plan);

    // Prepare update data
    const updateData = {
      plan,
      modules: { ...newPlanConfig.modules },
      limits: { ...newPlanConfig.limits }
    };

    // Update school
    const school = await School.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).select('plan modules limits name code');

    if (!school) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'School not found'
      });
    }

    // Log the plan change
    await auditLog({
      action: 'SCHOOL_PLAN_UPDATED',
      userId: req.user._id,
      role: req.user.role,
      entityType: 'School',
      entityId: school._id,
      description: `Updated plan for school "${school.name}" (${school.code}) from ${currentSchool.plan} to ${plan}`,
      details: {
        schoolName: school.name,
        schoolCode: school.code,
        oldPlan: currentSchool.plan,
        newPlan: plan,
        isDowngrade,
        confirmed: confirmed || false,
        oldLimits: currentSchool.limits,
        newLimits: school.limits,
        modulesChanged: true // All modules are updated based on plan
      },
      req
    });

    logger.success(`School plan updated: ${school.name} (${school.code}) - ${currentSchool.plan} -> ${plan}`);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: `School plan updated successfully from ${currentSchool.plan} to ${plan}`,
      data: {
        school: {
          id: school._id,
          name: school.name,
          code: school.code,
          plan: school.plan
        },
        limits: school.limits,
        modules: school.modules,
        wasDowngrade: isDowngrade
      }
    });
  } catch (error) {
    logger.error('Update school plan error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error updating school plan',
      error: error.message
    });
  }
};

// Get Current User's School Subscription Status
export const getCurrentUserSchoolSubscription = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;

    if (!schoolId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'School ID not found in user token'
      });
    }

    const school = await School.findById(schoolId).select('subscription name code plan');
    if (!school) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'School not found'
      });
    }

    const now = new Date();
    const endDate = new Date(school.subscription.endDate);
    const gracePeriodEnd = new Date(endDate.getTime() + (school.subscription.gracePeriodDays * 24 * 60 * 60 * 1000));

    const isExpired = now > gracePeriodEnd;
    const isInGracePeriod = now > endDate && now <= gracePeriodEnd;
    const daysRemaining = isExpired ? 0 : Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: {
        school: {
          id: school._id,
          name: school.name,
          code: school.code,
          plan: school.plan
        },
        subscription: {
          ...school.subscription.toObject(),
          isExpired,
          isInGracePeriod,
          daysRemaining,
          gracePeriodEnd
        }
      }
    });
  } catch (error) {
    logger.error('Get current user school subscription error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error fetching subscription status',
      error: error.message
    });
  }
};

// Renew School Subscription
export const renewSchoolSubscription = async (req, res) => {
  try {
    const { id } = req.params;
    const { durationMonths = 12, extendFromCurrent = true } = req.body;

    // Validate duration
    if (durationMonths < 1 || durationMonths > 36) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Duration must be between 1 and 36 months'
      });
    }

    const school = await School.findById(id).select('subscription name code');
    if (!school) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'School not found'
      });
    }

    const now = new Date();
    let newEndDate;

    if (extendFromCurrent || school.subscription.endDate > now) {
      // Extend from current end date or current date (whichever is later)
      const baseDate = school.subscription.endDate > now ? school.subscription.endDate : now;
      newEndDate = new Date(baseDate.getTime() + (durationMonths * 30 * 24 * 60 * 60 * 1000)); // Approximate months
    } else {
      // Start from today
      newEndDate = new Date(now.getTime() + (durationMonths * 30 * 24 * 60 * 60 * 1000));
    }

    const updatedSchool = await School.findByIdAndUpdate(
      id,
      {
        'subscription.endDate': newEndDate,
        'subscription.isExpired': false,
        'subscription.lastRenewalDate': now
      },
      { new: true, runValidators: true }
    ).select('subscription name code');

    if (!updatedSchool) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'School not found'
      });
    }

    // Log the subscription renewal
    await auditLog({
      action: 'SCHOOL_SUBSCRIPTION_RENEWED',
      userId: req.user._id,
      role: req.user.role,
      entityType: 'School',
      entityId: school._id,
      description: `Renewed subscription for school "${school.name}" (${school.code}) for ${durationMonths} months`,
      details: {
        schoolName: school.name,
        schoolCode: school.code,
        durationMonths,
        oldEndDate: school.subscription.endDate,
        newEndDate: updatedSchool.subscription.endDate,
        extendedFromCurrent: extendFromCurrent
      },
      req
    });

    logger.success(`School subscription renewed: ${school.name} (${school.code}) - ${durationMonths} months`);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: `School subscription renewed successfully for ${durationMonths} months`,
      data: {
        school: {
          id: updatedSchool._id,
          name: updatedSchool.name,
          code: updatedSchool.code
        },
        subscription: updatedSchool.subscription
      }
    });
  } catch (error) {
    logger.error('Renew school subscription error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error renewing subscription',
      error: error.message
    });
  }
};

// Update School Modules
export const updateSchoolModules = async (req, res) => {
  try {
    const { id } = req.params;
    const { modules } = req.body;

    // Validate modules
    if (!modules || typeof modules !== 'object') {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Modules object is required'
      });
    }

    // Validate that all provided modules are valid
    const validModules = Object.values(SCHOOL_MODULES);
    const providedModules = Object.keys(modules);

    for (const module of providedModules) {
      if (!validModules.includes(module)) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          message: `Invalid module: ${module}`
        });
      }
      if (typeof modules[module] !== 'boolean') {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          message: `Module ${module} must be a boolean value`
        });
      }
    }

    // Get current modules for audit logging
    const currentSchool = await School.findById(id).select('modules name code');
    if (!currentSchool) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'School not found'
      });
    }

    // Build update object
    const updateData = {};
    for (const module of providedModules) {
      updateData[`modules.${module}`] = modules[module];
    }

    const school = await School.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).select('modules name code');

    if (!school) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'School not found'
      });
    }

    // Log the module updates
    const changes = [];
    for (const module of providedModules) {
      if (currentSchool.modules[module] !== modules[module]) {
        changes.push({
          module,
          oldValue: currentSchool.modules[module],
          newValue: modules[module]
        });
      }
    }

    if (changes.length > 0) {
      await auditLog({
        action: 'SCHOOL_MODULES_UPDATED',
        userId: req.user._id,
        role: req.user.role,
        entityType: 'School',
        entityId: school._id,
        description: `Updated modules for school "${school.name}" (${school.code})`,
        details: {
          schoolName: school.name,
          schoolCode: school.code,
          changes
        },
        req
      });
    }

    logger.success(`School modules updated: ${school.name} (${school.code})`);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'School modules updated successfully',
      data: school
    });
  } catch (error) {
    logger.error('Update school modules error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error updating school modules',
      error: error.message
    });
  }
};

// Force Logout All Users for a School
export const forceLogoutSchool = async (req, res) => {
  try {
    const { id } = req.params;

    // Find the school
    const school = await School.findById(id).select('name code');
    if (!school) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'School not found'
      });
    }

    // Update force logout timestamp
    const forceLogoutAt = new Date();
    await School.findByIdAndUpdate(id, { forceLogoutAt });

    // Log the force logout action
    await auditLog({
      action: 'SCHOOL_FORCE_LOGOUT',
      userId: req.user._id,
      role: req.user.role,
      entityType: 'School',
      entityId: school._id,
      description: `Force logout triggered for all users of school "${school.name}" (${school.code})`,
      details: {
        schoolName: school.name,
        schoolCode: school.code,
        forceLogoutAt
      },
      req
    });

    logger.success(`Force logout triggered for school: ${school.name} (${school.code})`);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Force logout initiated successfully. All users will be logged out on their next request.',
      data: {
        school: {
          id: school._id,
          name: school.name,
          code: school.code
        },
        forceLogoutAt
      }
    });
  } catch (error) {
    logger.error('Force logout school error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error initiating force logout',
      error: error.message
    });
  }
};
