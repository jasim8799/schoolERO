const mongoose = require('mongoose');
const School = require('../models/School.js');
const User = require('../models/User.js');
const Teacher = require('../models/Teacher.js');
const AcademicSession = require('../models/AcademicSession.js');
const { HTTP_STATUS, USER_ROLES, SCHOOL_MODULES, SAAS_PLANS, USER_STATUS } = require('../config/constants.js');
const { logger } = require('../utils/logger.js');
const { auditLog } = require('../utils/auditLog.js');
const { applyPlanToSchool, getPlanConfig } = require('../utils/planManager.js');
const bcrypt = require('bcrypt');
const { hashPassword } = require('../utils/password.js');
const { createUser } = require('./user.controller.js');
const { createTeacher: createTeacherProfile } = require('./teacher.controller.js');

const PLAN_PRICES = { BASIC: 9000, STANDARD: 18000, PREMIUM: 32000 };

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

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
    const redis = require('../config/redis');
    const {
      status,
      plan,
      sort = 'updatedAt',
      page = 1,
      limit = 50,
      search,
      riskLevel
    } = req.query;

    const cacheKey = `schools:list:${status}:${plan}:${sort}:${page}:${search || ''}:${riskLevel || ''}:${limit}`;
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) {
      return res.json({ success: true, ...JSON.parse(cached), cached: true });
    }

    const query = { isDeleted: { $ne: true } };
    if (status && status !== 'ALL') {
      const now = new Date();
      if (status === 'ACTIVE') {
        query['subscription.endDate'] = { $gt: now };
      }
      if (status === 'EXPIRED') {
        query['subscription.endDate'] = { $lte: new Date(Date.now() - 30 * 86400000) };
      }
      if (status === 'GRACE') {
        query['subscription.endDate'] = {
          $lte: now,
          $gt: new Date(Date.now() - 30 * 86400000)
        };
      }
      if (status === 'TRIAL') {
        query.plan = SAAS_PLANS.BASIC;
      }
    }

    if (plan && plan !== 'ALL') {
      query.plan = plan;
    }
    if (riskLevel && riskLevel !== 'ALL') {
      query.riskLevel = riskLevel;
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } },
        { city: { $regex: search, $options: 'i' } }
      ];
    }

    const sortMap = {
      Activity: { 'analytics.lastAnalyticsSync': -1 },
      Health: { healthScore: -1 },
      Revenue: { 'analytics.todayFeeCollection': -1 },
      Security: { 'analytics.securityScore': -1 }
    };
    const sortObj = sortMap[sort] || { updatedAt: -1 };
    const parsedLimit = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const skip = (parsedPage - 1) * parsedLimit;

    const [schools, total] = await Promise.all([
      School.find(query).sort(sortObj).skip(skip).limit(parsedLimit).lean(),
      School.countDocuments(query)
    ]);

    const data = schools.map((s) => {
      const now = new Date();
      const endDate = new Date(s.subscription?.endDate || now);
      const graceEnd = new Date(endDate.getTime() + ((s.subscription?.gracePeriodDays || 30) * 86400000));
      const subStatus = now > graceEnd ? 'EXPIRED' : now > endDate ? 'GRACE' : 'ACTIVE';

      return {
        ...s,
        studentsCount: s.analytics?.studentsCount || 0,
        teachersCount: s.analytics?.teachersCount || 0,
        onlineUsers: s.analytics?.onlineUsers || 0,
        todayAttendance: s.analytics?.todayAttendancePct || 0,
        alertsCount: s.analytics?.alertsCount || 0,
        todayCollection: s.analytics?.todayFeeCollection || 0,
        apiRequestsToday: s.analytics?.apiRequestsToday || 0,
        storageUsage: s.analytics?.storageUsedBytes || 0,
        storageLimit: s.limits?.storageLimit || 1073741824,
        apiLatencyMs: s.analytics?.apiLatencyMs || 24,
        securityScore: s.analytics?.securityScore || 94,
        cpuUsage: s.analytics?.cpuUsagePct || 0.4,
        city: s.city || s.address?.split(',').pop()?.trim() || 'N/A',
        board: s.board || 'CBSE',
        subscriptionStatus: subStatus
      };
    });

    const payload = { success: true, count: data.length, total, data };
    await redis.setex(cacheKey, 30, JSON.stringify(payload)).catch(() => {});
    return res.json(payload);
  } catch (error) {
    console.error('[getAllSchools]', error.message);
    return res.status(500).json({ success: false, message: error.message });
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

// Update School (basic info)
const updateSchool = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, address, contact, plan } = req.body;

    // Build update object
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (address !== undefined) updateData.address = address;
    if (contact !== undefined) updateData.contact = contact;
    
    // Only allow plan update if valid
    if (plan !== undefined && Object.values(SAAS_PLANS).includes(plan)) {
      updateData.plan = plan;
    }

    // If no valid fields to update
    if (Object.keys(updateData).length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'No valid fields to update'
      });
    }

    // Find and update school
    const school = await School.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!school) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'School not found'
      });
    }

    // Log the update
    await auditLog({
      action: 'SCHOOL_UPDATED',
      userId: req.user._id,
      role: req.user.role,
      entityType: 'School',
      entityId: school._id,
      description: `Updated school "${school.name}" (${school.code})`,
      details: {
        schoolName: school.name,
        schoolCode: school.code,
        updatedFields: Object.keys(updateData)
      },
      req
    });

    logger.success(`School updated: ${school.name} (${school.code})`);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'School updated successfully',
      data: school
    });
  } catch (error) {
    logger.error('Update school error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error updating school',
      error: error.message
    });
  }
};

// Create School with Lifecycle (Super Admin only)
const createSchoolWithLifecycle = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  let school, principal, defaultSession;

  try {
    const {
      name,
      code,
      address,
      contact,
      plan,
      monthlyPrice,  // NEW: Accept monthly price
      principalName,
      principalEmail,
      principalMobile,
      principalPassword
    } = req.body;

    console.log('[DEBUG] Incoming createSchool payload:', req.body);

    // Validate required fields
    if (!name?.trim() || !code?.trim()) {
      console.log('[VALIDATION FAILED - EMPTY VALUES]', { name, code });
      return res.status(400).json({
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
    if (!principalEmail || !principalName) {
      console.log('[VALIDATION FAILED]', { name, code, principalEmail });
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Principal email and name are required'
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
      status: 'active',
      subscription: {
        plan: plan || SAAS_PLANS.BASIC,
        monthlyPrice: monthlyPrice || 499, // Default price in rupees
        startDate: new Date(),
        endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days trial
        status: 'ACTIVE',
        isExpired: false,
        autoRenew: true,
        gracePeriodDays: 30,
        lastRenewalDate: new Date()
      }
    };

    // Apply plan configuration
    const schoolDataWithPlan = applyPlanToSchool(schoolData, schoolData.plan);

    // 1. Create school
    const createdSchools = await School.create([schoolDataWithPlan], { session });
    school = createdSchools[0];

    console.log('[DEBUG] School created:', school._id, school.name, school.code);

    // 2. Create or assign Principal
    if (principalEmail) {
      // Auto-generate password if empty
      const finalPassword = principalPassword?.trim() ? principalPassword : 'Temp@1234';
      console.log('[DEBUG] Principal password auto-generated:', !principalPassword?.trim());

      // Check if principal with this email already exists
      principal = await User.findOne(
        { email: principalEmail.toLowerCase() }
      ).session(session);
      if (principal) {
        // Update existing user to be principal of this school
        principal.role = USER_ROLES.PRINCIPAL;
        principal.schoolId = school._id;
        principal.status = USER_STATUS.ACTIVE;
        const hashedPassword = await hashPassword(finalPassword);
        principal.password = hashedPassword;
        await principal.save({ session });
      } else {
        // Create new principal
        const hashedPassword = await hashPassword(finalPassword);

        const principals = await User.create([{
          name: principalName,
          email: principalEmail.toLowerCase(),
          mobile: principalMobile,
          password: hashedPassword,
          role: USER_ROLES.PRINCIPAL,
          schoolId: school._id,
          status: USER_STATUS.ACTIVE
        }], { session });

        principal = principals[0];
      }
    }

    console.log(
      '[PRINCIPAL CREATED]',
      principal._id,
      principal.email,
      'school:',
      school.code
    );

    console.log('[DEBUG] Principal created:', principal._id, principal.email);

    // 3. Apply default plan & limits (create default academic session)
    const currentYear = new Date().getFullYear();
    defaultSession = await AcademicSession.create([{
      name: `${currentYear}-${currentYear + 1}`,
      startDate: new Date(currentYear, 3, 1), // April 1st
      endDate: new Date(currentYear + 1, 2, 31), // March 31st
      schoolId: school._id,
      isActive: true
    }], { session });

    console.log('[DEBUG] Academic session created:', defaultSession[0]._id, 'name:', defaultSession[0].name);

    console.log('[CONFIRM TRANSACTION]', {
      schoolId: school?._id,
      principalId: principal?._id,
      principalEmail: principal?.email
    });

    console.log('[DEBUG] Ready to commit transaction');

    await session.commitTransaction();

    console.log('[DEBUG] Transaction committed successfully');

    global.io?.emit('school:created', {
      name: school.name,
      code: school.code,
      plan: school.plan,
      at: new Date()
    });
    global.io?.emit('system:activity', {
      type: 'SCHOOL_CREATED',
      label: school.name,
      at: new Date()
    });

    logger.success(`School lifecycle created: ${school.name} (${school.code})`);

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: 'School created successfully with lifecycle setup',
      data: {
        school: school,
        principal: principal || null,
        defaultSession: defaultSession[0]
      }
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('[TRANSACTION ABORTED]', error.message);
    logger.error('Create school lifecycle error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error creating school with lifecycle',
      error: error.message
    });
  } finally {
    session.endSession();
  }

  // Log creation action after successful transaction
  if (school && school._id && req.user?._id) {
    try {
      await auditLog({
        action: 'SCHOOL_CREATED',
        userId: req.user._id,
        role: req.user.role,
        entityType: 'SCHOOL',
        entityId: school._id,
        description: `Created school "${school.name}" (${school.code})`,
        details: {
          principalCreated: !!principal,
          principalEmail: principal?.email || null
        },
        req
      });
      console.log('[AUDIT LOG SUCCESS]');
    } catch (err) {
      console.error('[AUDIT LOG FAILED]', err.message);
    }
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

    global.io?.emit('school:status_changed', {
      schoolId: school._id,
      status,
      name: school.name
    });

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
        message: 'School not linked to user'
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
        message: 'School not linked to user'
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
        message: 'School not linked to user'
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

    const AuditLog = require('../models/AuditLog.js');

    const school = await School.findById(id).select('subscription name code plan');
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
      newEndDate = addMonths(baseDate, durationMonths);
    } else {
      // Start from today
      newEndDate = addMonths(now, durationMonths);
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

    const planPrice = PLAN_PRICES[school.plan] || PLAN_PRICES.BASIC;
    const invoiceAmount = planPrice * durationMonths;

    await AuditLog.create({
      action: 'SUBSCRIPTION_RENEWED',
      userId: req.user._id,
      role: req.user.role,
      entityType: 'SCHOOL',
      entityId: school._id,
      description: `Subscription renewed: ${school.name} - ${durationMonths}mo - INR ${invoiceAmount}`,
      severity: 'INFO',
      details: { durationMonths, invoiceAmount, newEndDate, plan: school.plan },
      ipAddress: req.ip,
      schoolId: school._id
    }).catch(() => {});

    global.io?.emit('school:subscription_renewed', {
      schoolId: updatedSchool._id,
      name: updatedSchool.name,
      newEndDate: updatedSchool.subscription.endDate
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
    const {
      name,
      email,
      mobile,
      password,
      role,
      gender,
      dateOfBirth,
      bloodGroup,
      address,
      city,
      state,
      pincode,
      whatsappNumber,
      employeeId,
      designation,
      department,
      dateOfJoining,
      qualification,
      experienceYears,
      previousSchool,
      subjects,
      monthlySalary,
      accountNumber,
      bankName,
      ifscCode,
      upiId,
      emergencyContactName,
      emergencyContactRelation,
      emergencyContactPhone,
      spouseName,
      spouseMobile,
    } = req.body;

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

    if (!req.user.schoolId || req.user.schoolId.toString() !== schoolId.toString()) {
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
      status: USER_STATUS.ACTIVE,
      gender,
      dateOfBirth,
      bloodGroup,
      address,
      city,
      state,
      pincode,
      whatsappNumber,
      employeeId,
      designation,
      department,
      dateOfJoining,
      qualification,
      experienceYears,
      previousSchool,
      subjects: subjects || [],
      monthlySalary,
      accountNumber,
      bankName,
      ifscCode,
      upiId,
      emergencyContactName,
      emergencyContactRelation,
      emergencyContactPhone,
      spouseName,
      spouseMobile,
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

    global.io?.emit('security:force_logout', {
      schoolId: school._id,
      name: school.name,
      at: new Date()
    });

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

// Get platform-wide school totals for metrics cards
const getSchoolTotals = async (req, res) => {
  try {
    const redis = require('../config/redis');
    const cacheKey = 'schools:totals:v2';
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) {
      return res.json({ success: true, data: JSON.parse(cached), cached: true });
    }

    const safeQuery = (p, fb) => Promise.race([
      p,
      new Promise((resolve) => setTimeout(() => resolve(fb), 8000))
    ]).catch(() => fb);

    const [agg] = await safeQuery(
      School.aggregate([
        { $match: { isDeleted: { $ne: true } } },
        {
          $group: {
            _id: null,
            totalStudents: { $sum: '$analytics.studentsCount' },
            totalTeachers: { $sum: '$analytics.teachersCount' },
            totalOnlineUsers: { $sum: '$analytics.onlineUsers' },
            totalAttendance: { $avg: '$analytics.todayAttendancePct' },
            totalFeeToday: { $sum: '$analytics.todayFeeCollection' },
            totalAlerts: { $sum: '$analytics.alertsCount' },
            totalApiRequests: { $sum: '$analytics.apiRequestsToday' },
            totalStorage: { $sum: '$analytics.storageUsedBytes' },
            avgSecurity: { $avg: '$analytics.securityScore' },
            totalSchools: { $sum: 1 }
          }
        }
      ]),
      [{}]
    );

    const now = new Date();
    const [active, expired, grace] = await Promise.all([
      safeQuery(
        School.countDocuments({
          isDeleted: { $ne: true },
          'subscription.endDate': { $gt: now }
        }),
        0
      ),
      safeQuery(
        School.countDocuments({
          isDeleted: { $ne: true },
          'subscription.endDate': { $lte: new Date(Date.now() - 30 * 86400000) }
        }),
        0
      ),
      safeQuery(
        School.countDocuments({
          isDeleted: { $ne: true },
          'subscription.endDate': {
            $lte: now,
            $gt: new Date(Date.now() - 30 * 86400000)
          }
        }),
        0
      )
    ]);

    const a = agg || {};
    const data = {
      totalSchools: a.totalSchools || 0,
      totalStudents: a.totalStudents || 0,
      totalTeachers: a.totalTeachers || 0,
      totalOnlineUsers: a.totalOnlineUsers || 0,
      totalAttendance: Math.round(a.totalAttendance || 0),
      totalFeeToday: a.totalFeeToday || 0,
      totalAlerts: a.totalAlerts || 0,
      totalApiRequests: a.totalApiRequests || 0,
      totalStorageGb: parseFloat(((a.totalStorage || 0) / 1073741824).toFixed(2)),
      avgSecurityScore: Math.round(a.avgSecurity || 94),
      activeSubscriptions: active,
      expiredSubscriptions: expired,
      graceSubscriptions: grace,
      generatedAt: now
    };

    await redis.setex(cacheKey, 60, JSON.stringify(data)).catch(() => {});
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Get analytics snapshot for a single school
const getSchoolAnalytics = async (req, res) => {
  try {
    const { id } = req.params;
    const redis = require('../config/redis');
    const Student = require('../models/Student.js');
    const StudentDailyAttendance = require('../models/StudentDailyAttendance.js');
    const AuditLog = require('../models/AuditLog.js');

    const cacheKey = `school:analytics:${id}`;
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) {
      return res.json({ success: true, data: JSON.parse(cached), cached: true });
    }

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const monthAgo = new Date(now.getTime() - 30 * 86400000);

    const safeQuery = (p, fb) => Promise.race([
      p,
      new Promise((resolve) => setTimeout(() => resolve(fb), 5000))
    ]).catch(() => fb);

    const schoolObjectId = mongoose.Types.ObjectId.isValid(id)
      ? new mongoose.Types.ObjectId(id)
      : null;

    const [
      totalStudents,
      totalTeachers,
      attendanceThisWeek,
      loginCountThisMonth,
      auditEventsThisMonth,
      school
    ] = await Promise.all([
      safeQuery(Student.countDocuments({ schoolId: id }), 0),
      safeQuery(User.countDocuments({ schoolId: id, role: 'TEACHER', isDeleted: { $ne: true } }), 0),
      schoolObjectId
        ? safeQuery(
          StudentDailyAttendance.aggregate([
            { $match: { schoolId: schoolObjectId, createdAt: { $gte: weekAgo } } },
            {
              $group: {
                _id: null,
                present: { $sum: { $cond: [{ $eq: ['$status', 'PRESENT'] }, 1, 0] } },
                total: { $sum: 1 }
              }
            }
          ]),
          []
        )
        : Promise.resolve([]),
      safeQuery(AuditLog.countDocuments({ schoolId: id, action: 'LOGIN', createdAt: { $gte: monthAgo } }), 0),
      safeQuery(AuditLog.countDocuments({ schoolId: id, createdAt: { $gte: monthAgo } }), 0),
      safeQuery(School.findById(id).select('analytics limits').lean(), null)
    ]);

    const attendancePct = attendanceThisWeek[0]?.total > 0
      ? Math.round((attendanceThisWeek[0].present / attendanceThisWeek[0].total) * 100)
      : 0;

    const data = {
      totalStudents,
      totalTeachers,
      attendancePctThisWeek: attendancePct,
      loginCountThisMonth,
      auditEventsThisMonth,
      storageUsedBytes: school?.analytics?.storageUsedBytes || 0,
      storageLimit: school?.limits?.storageLimit || 1073741824,
      generatedAt: now
    };

    await redis.setex(cacheKey, 120, JSON.stringify(data)).catch(() => {});
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Get security summary for a single school
const getSchoolSecuritySummary = async (req, res) => {
  try {
    const { id } = req.params;
    const redis = require('../config/redis');
    const SecurityLog = require('../models/SecurityLog.js');
    const LoginSession = require('../models/LoginSession.js');
    const AuditLog = require('../models/AuditLog.js');

    const cacheKey = `school:security:${id}`;
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) {
      return res.json({ success: true, data: JSON.parse(cached), cached: true });
    }

    const dayAgo = new Date(Date.now() - 86400000);
    const weekAgo = new Date(Date.now() - 7 * 86400000);

    const safeQuery = (p, fb) => Promise.race([
      p,
      new Promise((resolve) => setTimeout(() => resolve(fb), 5000))
    ]).catch(() => fb);

    const [failedLogins, activeSessions, securityEvents, criticalEvents] = await Promise.all([
      safeQuery(AuditLog.countDocuments({ schoolId: id, action: 'LOGIN_FAILED', createdAt: { $gte: dayAgo } }), 0),
      safeQuery(LoginSession.countDocuments({ schoolId: id, isActive: true }), 0),
      safeQuery(SecurityLog.countDocuments({ schoolId: id, createdAt: { $gte: weekAgo } }), 0),
      safeQuery(AuditLog.countDocuments({ schoolId: id, severity: 'CRITICAL', createdAt: { $gte: weekAgo } }), 0)
    ]);

    const securityScore = Math.max(60, 100 - failedLogins * 5 - criticalEvents * 10);
    const riskLevel = securityScore >= 85 ? 'LOW' : securityScore >= 70 ? 'MEDIUM' : 'HIGH';

    const data = {
      failedLogins24h: failedLogins,
      activeSessions,
      securityEvents7d: securityEvents,
      criticalEvents7d: criticalEvents,
      securityScore,
      riskLevel
    };

    await redis.setex(cacheKey, 60, JSON.stringify(data)).catch(() => {});
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  createSchool,
  getSchoolLimits,
  updateSchoolLimits,
  getAllSchools,
  getSchoolById,
  updateSchool,
  createSchoolWithLifecycle,
  toggleSchoolStatus,
  assignPrincipal,
  getCurrentUserSchoolModules,
  getCurrentUserSchoolOnlinePayments,
  getSchoolModules,
  updateSchoolPlan,
  getCurrentUserSchoolSubscription,
  renewSchoolSubscription,
  getSchoolTotals,
  getSchoolAnalytics,
  getSchoolSecuritySummary,
  updateSchoolModules,
  createOperator,
  createParent,
  createStudent,
  createTeacher,
  forceLogoutSchool
};
