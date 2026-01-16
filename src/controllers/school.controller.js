const mongoose = require('mongoose');
const School = require('../models/School.js');
const User = require('../models/User.js');
const Teacher = require('../models/Teacher.js');
const AcademicSession = require('../models/AcademicSession.js');
const { HTTP_STATUS, USER_ROLES, SCHOOL_MODULES, SAAS_PLANS, USER_STATUS } = require('../config/constants.js');
const { logger } = require('../utils/logger.js');
const { auditLog } = require('../utils/auditLog_new.js');
const { applyPlanToSchool, getPlanConfig } = require('../utils/planManager.js');
const bcrypt = require('bcrypt');
const { hashPassword } = require('../utils/password.js');
const { createUser } = require('./user.controller.js');
const { createTeacher: createTeacherProfile } = require('./teacher.controller.js');

// Create School
const createSchool = async (req, res) => {
  try {
    const { schoolName, schoolCode, plan, limits } = req.body;

    // Validate required fields
    if (!schoolName || !schoolCode) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'School name and code are required'
      });
    }

    // Validate limits object
    if (!limits || typeof limits !== 'object') {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Limits object is required'
      });
    }

    if (typeof limits.students !== 'number' || limits.students <= 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Valid students limit is required'
      });
    }

    if (typeof limits.teachers !== 'number' || limits.teachers <= 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Valid teachers limit is required'
      });
    }

    if (typeof limits.storage !== 'number' || limits.storage <= 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Valid storage limit is required'
      });
    }

    // Validate plan
    if (!plan || !Object.values(SAAS_PLANS).includes(plan)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Valid plan is required (BASIC, STANDARD, PREMIUM)'
      });
    }

    // Check if school code already exists
    const existingSchool = await School.findOne({ code: schoolCode.toUpperCase() });
    if (existingSchool) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'School code already exists'
      });
    }

    // Prepare school data
    const schoolData = {
      name: schoolName,
      code: schoolCode.toUpperCase(),
      plan,
      limits: {
        studentLimit: limits.students,
        teacherLimit: limits.teachers,
        storageLimit: limits.storage
      }
    };

    // Apply plan configuration (this will override limits based on plan, but we set them explicitly)
    const schoolDataWithPlan = applyPlanToSchool(schoolData, schoolData.plan);

    // Create school
    const school = await School.create(schoolDataWithPlan);

    logger.success(`School created: ${school.name} (${school.code}) with plan: ${school.plan}`);

    // Audit log (wrap in try-catch to prevent breaking response)
    try {
      await auditLog({
        action: 'SCHOOL_CREATED',
        userId: req.user._id,
        role: req.user.role,
        entityType: 'SCHOOL',
        entityId: school._id,
        description: `School "${school.name}" (${school.code}) created`,
        schoolId: req.user.schoolId || null,
        req
      });
    } catch (auditError) {
      logger.error('Audit log failed for school creation:', auditError.message);
      // Continue with response, don't break school creation
    }

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
const getSchoolLimits = async (req, res) => {
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
const updateSchoolLimits = async (req, res) => {
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
const getAllSchools = async (req, res) => {
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
const getSchoolById = async (req, res) => {
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
const createSchoolWithLifecycle = async (req, res) => {
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

    // Validate principal fields (mandatory for school creation)
    if (!principalEmail || !principalName || !principalPassword) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Principal email, name, and password are required'
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
      plan: plan || SAAS_PLANS.BASIC, // Default to BASIC if not specified
      status: SCHOOL_STATUS.ACTIVE,
      subscription: {
        endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days trial
        isExpired: false,
        gracePeriodDays: 30,
        lastRenewalDate: new Date()
      }
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
        principal.status = USER_STATUS.ACTIVE;
        const hashedPassword = await hashPassword(principalPassword || 'TempPass123!');
        principal.password = hashedPassword;
        await principal.save({ session });
      } else {
        // Create new principal
        const hashedPassword = await hashPassword(principalPassword || 'TempPass123!');
        principal = await User.create([{
          name: principalName,
          email: principalEmail.toLowerCase(),
          mobile: principalMobile,
          password: hashedPassword,
          role: USER_ROLES.PRINCIPAL,
          schoolId: school[0]._id,
          status: USER_STATUS.ACTIVE
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
      action: 'SCHOOL_CREATED',
      userId: req.user._id,
      role: req.user.role,
      entityType: 'SCHOOL',
      entityId: school[0]._id,
      description: `Created school "${school[0].name}" (${school[0].code}) with lifecycle setup`,
      schoolId: req.user.schoolId || null,
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
const toggleSchoolStatus = async (req, res) => {
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

// Assign Principal
const assignPrincipal = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    // Validate required fields
    if (!userId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'User ID is required'
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

    // Find the user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if user is already a principal at another school
    if (user.role === USER_ROLES.PRINCIPAL && user.schoolId && user.schoolId.toString() !== id) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Selected user is already a principal at another school'
      });
    }

    // Check if school already has an active principal
    const currentPrincipal = await User.findOne({
      role: USER_ROLES.PRINCIPAL,
      schoolId: id,
      status: USER_STATUS.ACTIVE
    });

    if (currentPrincipal && currentPrincipal._id.toString() !== userId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'School already has an active principal. Please reassign or deactivate the current principal first.'
      });
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Update user to be principal
      const updatedUser = await User.findByIdAndUpdate(
        userId,
        {
          role: USER_ROLES.PRINCIPAL,
          schoolId: id,
          status: USER_STATUS.ACTIVE,
          deactivatedAt: null,
          deactivatedBy: null
        },
        { new: true, session }
      );

      // Log the assignment
      await auditLog({
        action: 'PRINCIPAL_ASSIGNED',
        userId: req.user._id,
        role: req.user.role,
        entityType: 'School',
        entityId: school._id,
        description: `Principal assigned for school "${school.name}" (${school.code})`,
        details: {
          schoolName: school.name,
          schoolCode: school.code,
          principalId: updatedUser._id,
          principalName: updatedUser.name,
          principalEmail: updatedUser.email
        },
        req
      });

      await session.commitTransaction();

      logger.success(`Principal assigned for school: ${school.name} (${school.code})`);

      res.status(HTTP_STATUS.OK).json({
        success: true,
        message: 'Principal assigned successfully',
        data: {
          school,
          principal: updatedUser
        }
      });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  } catch (error) {
    logger.error('Assign principal error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error assigning principal',
      error: error.message
    });
  }
};

// Get Current User's School Modules
const getCurrentUserSchoolModules = async (req, res) => {
  try {
    // SUPER_ADMIN bypasses school checks
    if (req.user.role === USER_ROLES.SUPER_ADMIN) {
      return res.status(HTTP_STATUS.OK).json({
        success: true,
        data: {
          school: null,
          modules: []
        }
      });
    }

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
const getCurrentUserSchoolOnlinePayments = async (req, res) => {
  try {
    // SUPER_ADMIN bypasses school checks
    if (req.user.role === USER_ROLES.SUPER_ADMIN) {
      return res.status(HTTP_STATUS.OK).json({
        success: true,
        data: {
          available: false,
          planAllows: false,
          adminEnabled: false,
          school: null
        }
      });
    }

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
const getSchoolModules = async (req, res) => {
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
const updateSchoolPlan = async (req, res) => {
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
const getCurrentUserSchoolSubscription = async (req, res) => {
  try {
    // SUPER_ADMIN bypasses school checks
    if (req.user.role === USER_ROLES.SUPER_ADMIN) {
      return res.status(HTTP_STATUS.OK).json({
        success: true,
        data: {
          school: null,
          subscription: null
        }
      });
    }

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
const renewSchoolSubscription = async (req, res) => {
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
const updateSchoolModules = async (req, res) => {
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

// Create Operator for School
const createOperator = async (req, res) => {
  try {
    const { id: schoolId } = req.params;
    const { name, email, mobile, password, role } = req.body;

    // Validate required fields
    if (!name || !email || !password) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Name, email, and password are required'
      });
    }

    // Validate that the user is a PRINCIPAL and the schoolId matches their school
    if (req.user.role !== USER_ROLES.PRINCIPAL) {
      await auditLog({
        action: 'OPERATOR_CREATION_FAILED',
        userId: req.user._id,
        role: req.user.role,
        entityType: 'User',
        entityId: null,
        description: `Failed operator creation attempt: User is not a principal`,
        details: {
          attemptedEmail: email,
          reason: 'User is not a principal',
          requestedRole: role
        },
        req
      });
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'Only principals can create operators'
      });
    }

    if (!req.user.schoolId || req.user.schoolId.toString() !== schoolId) {
      await auditLog({
        action: 'OPERATOR_CREATION_FAILED',
        userId: req.user._id,
        role: req.user.role,
        entityType: 'User',
        entityId: null,
        description: `Failed operator creation attempt: School ID mismatch`,
        details: {
          attemptedEmail: email,
          reason: 'School ID mismatch',
          requestedRole: role,
          userSchoolId: req.user.schoolId,
          requestedSchoolId: schoolId
        },
        req
      });
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'You can only create operators for your own school'
      });
    }

    // Reject attempts to create PRINCIPAL, SUPER_ADMIN, or TEACHER
    if (role) {
      if ([USER_ROLES.PRINCIPAL, USER_ROLES.SUPER_ADMIN, USER_ROLES.TEACHER].includes(role)) {
        await auditLog({
          action: 'OPERATOR_CREATION_FAILED',
          userId: req.user._id,
          role: req.user.role,
          entityType: 'User',
          entityId: null,
          description: `Failed operator creation attempt: Attempted to create restricted role`,
          details: {
            attemptedEmail: email,
            reason: 'Attempted to create restricted role',
            requestedRole: role,
            allowedRole: USER_ROLES.OPERATOR
          },
          req
        });
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          message: 'Principals can only create operators. Cannot create principals, super admins, or teachers.'
        });
      }
      if (role !== USER_ROLES.OPERATOR) {
        await auditLog({
          action: 'OPERATOR_CREATION_FAILED',
          userId: req.user._id,
          role: req.user.role,
          entityType: 'User',
          entityId: null,
          description: `Failed operator creation attempt: Invalid role specified`,
          details: {
            attemptedEmail: email,
            reason: 'Invalid role specified',
            requestedRole: role,
            allowedRole: USER_ROLES.OPERATOR
          },
          req
        });
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          message: 'Principals can only create operators.'
        });
      }
    }

    // Find the school
    const school = await School.findById(schoolId).select('name code');
    if (!school) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'School not found'
      });
    }

    // Check if email already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      await auditLog({
        action: 'OPERATOR_CREATION_FAILED',
        userId: req.user._id,
        role: req.user.role,
        entityType: 'User',
        entityId: null,
        description: `Failed operator creation attempt: Email already exists`,
        details: {
          attemptedEmail: email,
          reason: 'Email already exists',
          requestedRole: role
        },
        req
      });
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Create operator (always set role to OPERATOR regardless of input)
    const operator = await User.create({
      name,
      email: email.toLowerCase(),
      mobile,
      password: hashedPassword,
      role: USER_ROLES.OPERATOR,
      schoolId,
      status: USER_STATUS.ACTIVE
    });

    // Log the operator creation
    await auditLog({
      action: 'OPERATOR_CREATED',
      userId: req.user._id,
      role: req.user.role,
      entityType: 'User',
      entityId: operator._id,
      description: `Operator created for school "${school.name}" (${school.code})`,
      details: {
        schoolName: school.name,
        schoolCode: school.code,
        operatorName: operator.name,
        operatorEmail: operator.email,
        createdBy: req.user.name
      },
      req
    });

    logger.success(`Operator created: ${operator.name} (${operator.email}) for school: ${school.name} (${school.code})`);

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: 'Operator created successfully',
      data: {
        operator: {
          _id: operator._id,
          name: operator.name,
          email: operator.email,
          mobile: operator.mobile,
          role: operator.role,
          schoolId: operator.schoolId,
          status: operator.status
        },
        school: {
          id: school._id,
          name: school.name,
          code: school.code
        }
      }
    });
  } catch (error) {
    logger.error('Create operator error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error creating operator',
      error: error.message
    });
  }
};

// Create Parent for School
const createParent = async (req, res) => {
  try {
    const { id: schoolId } = req.params;
    const { name, email, mobile, whatsappNumber, password } = req.body;

    // Validate required fields
    if (!name || !mobile || !password) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Name, mobile, and password are required'
      });
    }

    // Validate that the user is SUPER_ADMIN
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      await auditLog({
        action: 'PARENT_CREATION_FAILED',
        userId: req.user._id,
        role: req.user.role,
        entityType: 'User',
        entityId: null,
        description: `Failed parent creation attempt: User is not a super admin`,
        details: {
          attemptedMobile: mobile,
          reason: 'User is not a super admin'
        },
        req
      });
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'Only super admins can create parents'
      });
    }

    // Find the school
    const school = await School.findById(schoolId).select('name code');
    if (!school) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'School not found'
      });
    }

    // First create the user
    const userReq = {
      ...req,
      body: {
        name,
        mobile,
        whatsappNumber,
        password,
        role: USER_ROLES.PARENT,
        schoolId
      }
    };

    let userResponse;
    const userRes = {
      status: (code) => ({
        json: (data) => {
          userResponse = data;
          return data;
        }
      })
    };

    await createUser(userReq, userRes);

    if (!userResponse || !userResponse.success) {
      return res.status(userResponse ? HTTP_STATUS.BAD_REQUEST : HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: userResponse ? userResponse.message : 'Failed to create user'
      });
    }

    const userId = userResponse.data._id;

    // Create parent profile by calling the parent creation API
    const parentReq = {
      ...req,
      body: {
        userId,
        whatsappNumber,
        schoolId
      }
    };

    let parentResponse;
    const parentRes = {
      status: (code) => ({
        json: (data) => {
          parentResponse = data;
          return data;
        }
      })
    };

    const { createParent } = require('./parent.controller.js');
    await createParent(parentReq, parentRes);

    if (!parentResponse || !parentResponse.success) {
      // If parent creation fails, disable the user and mark as incomplete parent
      await User.findByIdAndUpdate(userId, {
        status: USER_STATUS.INACTIVE,
        deactivationReason: 'Parent profile creation failed - account disabled'
      });

      // Log the failure
      await auditLog({
        action: 'PARENT_CREATION_FAILED',
        userId: req.user._id,
        role: req.user.role,
        entityType: 'User',
        entityId: userId,
        description: `Parent profile creation failed for user "${userResponse.data.name}" - account disabled`,
        details: {
          userId,
          userName: userResponse.data.name,
          userMobile: userResponse.data.mobile,
          failureReason: parentResponse ? parentResponse.message : 'Unknown error in parent profile creation'
        },
        req
      });

      logger.error(`Parent profile creation failed for user ${userId} - account disabled`);

      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Parent profile creation failed. User account has been disabled. Please contact support.',
        error: parentResponse ? parentResponse.message : 'Failed to create parent profile'
      });
    }

    logger.success(`Parent created: ${userResponse.data.name} (${userResponse.data.mobile}) for school: ${school.name} (${school.code})`);

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: 'Parent created successfully',
      data: {
        user: userResponse.data,
        parent: parentResponse.data,
        school: {
          id: school._id,
          name: school.name,
          code: school.code
        }
      }
    });
  } catch (error) {
    logger.error('Create parent error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error creating parent',
      error: error.message
    });
  }
};

// Create Student for School
const createStudent = async (req, res) => {
  try {
    const { id: schoolId } = req.params;
    const { name, rollNumber, classId, sectionId, parentId, sessionId, dateOfBirth, gender, address } = req.body;

    // Validate required fields
    if (!name || !rollNumber || !classId || !sectionId || !parentId || !sessionId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'name, rollNumber, classId, sectionId, parentId, and sessionId are required'
      });
    }

    // Validate that the user is SUPER_ADMIN
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      await auditLog({
        action: 'STUDENT_CREATION_FAILED',
        userId: req.user._id,
        role: req.user.role,
        entityType: 'User',
        entityId: null,
        description: `Failed student creation attempt: User is not a super admin`,
        details: {
          attemptedName: name,
          reason: 'User is not a super admin'
        },
        req
      });
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'Only super admins can create students'
      });
    }

    // Find the school
    const school = await School.findById(schoolId).select('name code');
    if (!school) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'School not found'
      });
    }

    // Create student by calling the student creation API
    const studentReq = {
      ...req,
      body: {
        name,
        rollNumber,
        classId,
        sectionId,
        parentId,
        schoolId,
        sessionId,
        dateOfBirth,
        gender,
        address
      }
    };

    let studentResponse;
    const studentRes = {
      status: (code) => ({
        json: (data) => {
          studentResponse = data;
          return data;
        }
      })
    };

    const { createStudent } = require('./student.controller.js');
    await createStudent(studentReq, studentRes);

    if (!studentResponse || !studentResponse.success) {
      return res.status(studentResponse ? HTTP_STATUS.BAD_REQUEST : HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: studentResponse ? studentResponse.message : 'Failed to create student'
      });
    }

    logger.success(`Student created: ${name} (${rollNumber}) for school: ${school.name} (${school.code})`);

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: 'Student created successfully',
      data: {
        student: studentResponse.data,
        school: {
          id: school._id,
          name: school.name,
          code: school.code
        }
      }
    });
  } catch (error) {
    logger.error('Create student error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error creating student',
      error: error.message
    });
  }
};

// Create Teacher for School
const createTeacher = async (req, res) => {
  try {
    const { id: schoolId } = req.params;
    const { name, email, mobile, password, assignedClasses, assignedSubjects } = req.body;

    // Validate required fields
    if (!name || !email || !password) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Name, email, and password are required'
      });
    }

    // Validate that the user is SUPER_ADMIN
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      await auditLog({
        action: 'TEACHER_CREATION_FAILED',
        userId: req.user._id,
        role: req.user.role,
        entityType: 'User',
        entityId: null,
        description: `Failed teacher creation attempt: User is not a super admin`,
        details: {
          attemptedEmail: email,
          reason: 'User is not a super admin'
        },
        req
      });
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'Only super admins can create teachers'
      });
    }

    // Find the school
    const school = await School.findById(schoolId).select('name code');
    if (!school) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'School not found'
      });
    }

    // Validate assignedClasses and assignedSubjects if provided
    if (assignedClasses && !Array.isArray(assignedClasses)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'assignedClasses must be an array'
      });
    }

    if (assignedSubjects && !Array.isArray(assignedSubjects)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'assignedSubjects must be an array'
      });
    }

    // Validate that assignedClasses and assignedSubjects are not empty
    if (!assignedClasses || assignedClasses.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'assignedClasses cannot be empty'
      });
    }

    if (!assignedSubjects || assignedSubjects.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'assignedSubjects cannot be empty'
      });
    }

    // Create user first
    const mockReq = {
      body: {
        name,
        email,
        mobile,
        password,
        role: USER_ROLES.TEACHER,
        schoolId
      },
      user: req.user
    };

    let userResult;
    try {
      // Create a mock response object to capture the result
      const mockRes = {
        status: (code) => ({
          json: (data) => {
            if (code === HTTP_STATUS.CREATED && data.success) {
              userResult = data;
            } else {
              throw new Error(data.message || 'Failed to create user');
            }
          }
        })
      };

      await createUser(mockReq, mockRes);
    } catch (error) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: error.message || 'Failed to create user'
      });
    }

    if (!userResult || !userResult.data) {
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to create user'
      });
    }

    const userId = userResult.data._id;

    // Now create teacher profile
    const teacherMockReq = {
      body: {
        userId,
        assignedClasses,
        assignedSubjects,
        schoolId
      },
      user: req.user
    };

    let teacherResult;
    try {
      const teacherMockRes = {
        status: (code) => ({
          json: (data) => {
            if (code === HTTP_STATUS.CREATED && data.success) {
              teacherResult = data;
            } else {
              throw new Error(data.message || 'Failed to create teacher profile');
            }
          }
        })
      };

      await createTeacherProfile(teacherMockReq, teacherMockRes);
    } catch (error) {
      // Teacher profile creation failed, disable the created user
      try {
        await User.findByIdAndUpdate(userId, {
          status: USER_STATUS.INACTIVE,
          deactivatedAt: new Date(),
          deactivatedBy: req.user._id,
          deactivationReason: 'Teacher profile creation failed'
        });
      } catch (disableError) {
        logger.error('Failed to disable user after teacher creation failure:', disableError.message);
      }

      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Teacher profile creation failed. User account has been disabled.',
        error: error.message || 'Failed to create teacher profile'
      });
    }

    if (!teacherResult || !teacherResult.data) {
      // Disable the user if teacher profile creation failed
      try {
        await User.findByIdAndUpdate(userId, {
          status: USER_STATUS.INACTIVE,
          deactivatedAt: new Date(),
          deactivatedBy: req.user._id,
          deactivationReason: 'Teacher profile creation failed'
        });
      } catch (disableError) {
        logger.error('Failed to disable user after teacher creation failure:', disableError.message);
      }

      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Teacher profile creation failed. User account has been disabled.'
      });
    }

    logger.success(`Teacher created: ${name} (${email}) for school: ${school.name} (${school.code})`);

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: 'Teacher created successfully',
      data: {
        teacher: {
          _id: userId,
          name: userResult.data.name,
          email: userResult.data.email,
          mobile: userResult.data.mobile,
          role: userResult.data.role,
          schoolId: userResult.data.schoolId,
          status: userResult.data.status,
          assignedClasses: teacherResult.data.assignedClasses,
          assignedSubjects: teacherResult.data.assignedSubjects
        },
        school: {
          id: school._id,
          name: school.name,
          code: school.code
        }
      }
    });
  } catch (error) {
    logger.error('Create teacher error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error creating teacher',
      error: error.message
    });
  }
};

// Force Logout All Users for a School
const forceLogoutSchool = async (req, res) => {
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

module.exports = {
  createSchool,
  getSchoolLimits,
  updateSchoolLimits,
  getAllSchools,
  getSchoolById,
  createSchoolWithLifecycle,
  toggleSchoolStatus,
  assignPrincipal,
  getCurrentUserSchoolModules,
  getCurrentUserSchoolOnlinePayments,
  getSchoolModules,
  updateSchoolPlan,
  getCurrentUserSchoolSubscription,
  renewSchoolSubscription,
  updateSchoolModules,
  createOperator,
  createParent,
  createStudent,
  createTeacher,
  forceLogoutSchool
};
