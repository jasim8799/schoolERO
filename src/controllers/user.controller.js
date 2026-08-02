const User = require('../models/User.js');
const School = require('../models/School.js');
const LoginSession = require('../models/LoginSession.js');
const UserActivityLog = require('../models/UserActivityLog.js');
const { hashPassword, comparePassword } = require('../utils/password.js');
const { HTTP_STATUS, USER_ROLES } = require('../config/constants.js');
const { logger } = require('../utils/logger.js');
const { auditLog } = require('../utils/auditLog.js');
const redis = require('../config/redis.js');
const { config } = require('../config/env.js');
const FraudAlert = require('../models/FraudAlert.js');
const { enrichUserForDashboard } = require('../users/user.enricher.js');
const { calculateUserThreatScore } = require('../security/user.threat.scorer.js');

// Create User
const createUser = async (req, res) => {
  try {
    const {
      name, email, mobile, password, role, status,
      // Personal
      gender, dateOfBirth, bloodGroup, address, occupation, city, state, pincode, whatsappNumber,
      // Professional
      employeeId, designation, department, dateOfJoining, qualification,
      experienceYears, previousSchool, subjects,
      // Salary
      monthlySalary, accountNumber, bankName, ifscCode, upiId,
      // Emergency
      emergencyContactName, emergencyContactRelation, emergencyContactPhone,
      spouseName, spouseMobile,
    } = req.body;
    const schoolId = role === USER_ROLES.SUPER_ADMIN ? null : req.user.schoolId;

    // Validate required fields
    if (!name || !password || !role) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Name, password, and role are required'
      });
    }

    // Validate email or mobile
    if (!email && !mobile) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Either email or mobile is required'
      });
    }

    // Verify school exists (if schoolId provided)
    if (schoolId) {
      const school = await School.findById(schoolId);
      if (!school) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          success: false,
          message: 'School not found'
        });
      }
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [
        ...(email ? [{ email }] : []),
        ...(mobile ? [{ mobile }] : [])
      ]
    });

    if (existingUser) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'User with this email or mobile already exists'
      });
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Create user
    const user = await User.create({
      name,
      email,
      mobile,
      password: hashedPassword,
      role,
      schoolId,
      status: status || 'active',
      gender,
      dateOfBirth,
      bloodGroup,
      address,
      occupation,
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

logger.success(`User created: ${user.name} (${user.role}) by ${req.user.role}`);

// Create audit log with complete context
const targetSchoolId = user.schoolId?._id || user.schoolId;
const targetSchoolName = user.schoolId?.name || null;
await auditLog({
  action: 'USER_CREATED',
  category: 'USER',
  userId: req.user.userId,
  userName: req.user.name,
  role: req.user.role,
  entityType: 'USER',
  entityId: user._id,
  entityName: user.name,
  description: `User "${user.name}" created successfully with role ${user.role}`,
  schoolId: targetSchoolId,
  schoolName: targetSchoolName,
  details: { 
    role: user.role, 
    email, 
    mobile,
    createdBy: req.user.name,
    createdByRole: req.user.role
  },
  req: req
});

    // Remove password from response
    const userResponse = user.toObject();
    delete userResponse.password;

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: 'User created successfully',
      data: userResponse
    });
  } catch (error) {
    logger.error('Create user error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error creating user',
      error: error.message
    });
  }
};

// Get All Users
const getAllUsers = async (req, res) => {
  try {
    const { schoolId, role, status } = req.query;

    // Build query
    const query = {};
    
    if (schoolId) {
      query.schoolId = schoolId;
    }
    
    if (role) {
      query.role = role;
    }
    
    if (status) {
      query.status = status;
    }

    const users = await User.find(query)
      .populate('schoolId', 'name code')
      .select('-password')
      .sort({ createdAt: -1 });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      count: users.length,
      data: users
    });
  } catch (error) {
    logger.error('Get users error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error fetching users',
      error: error.message
    });
  }
};

// Super Admin: Get all users across all schools with security enrichment
const getSuperAdminUsers = async (req, res) => {
  try {
    if (req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Super Admin only.'
      });
    }

    const { role, status, schoolId, search, limit = 100, page = 1 } = req.query;

    const query = { isDeleted: { $ne: true } };
    if (role) query.role = role;
    if (status) query.status = status;
    if (schoolId) query.schoolId = schoolId;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { employeeId: { $regex: search, $options: 'i' } },
        { mobile: { $regex: search, $options: 'i' } },
      ];
    }

    const parsedLimit = Math.min(200, Math.max(1, parseInt(limit, 10) || 100));
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const skip = (parsedPage - 1) * parsedLimit;

    const cacheKey = `users:dashboard:${JSON.stringify({ role, status, schoolId, search, parsedLimit, parsedPage })}`;
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) {
      return res.status(HTTP_STATUS.OK).json(JSON.parse(cached));
    }

    const [users, totalCount] = await Promise.all([
      User.find(query)
        .populate('schoolId', 'name code plan')
        .select('-password')
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(parsedLimit)
        .lean(),
      User.countDocuments(query),
    ]);

    const enriched = await Promise.all(
      users.map((user) =>
        Promise.race([
          enrichUserForDashboard(user),
          new Promise((resolve) =>
            setTimeout(() => resolve({
              ...user,
              failedLogins: 0,
              successLogins: 0,
              threatScore: 0,
              riskLevel: 'LOW',
              sessionTokens: 1,
              liveDevices: 1,
              vpnDetected: false,
              mfaEnabled: false,
              encrypted: true,
              apiAccess: ['SUPER_ADMIN', 'PRINCIPAL'].includes(user.role),
              department: user.department || 'N/A',
              employeeId: user.employeeId || user._id.toString().slice(-6).toUpperCase(),
              ipAddress: 'N/A',
              device: 'Unknown',
              location: user.city ? `${user.city}, IN` : 'N/A',
              activeSessions: 0,
            }), 3000)
          ),
        ]).catch(() => ({ ...user, threatScore: 0, riskLevel: 'LOW' }))
      )
    );
    const metrics = _buildUserMetrics(enriched, totalCount);

    const payload = {
      success: true,
      count: enriched.length,
      totalCount,
      page: parsedPage,
      totalPages: Math.ceil(totalCount / parsedLimit),
      metrics,
      data: enriched,
    };

    await redis.setex(cacheKey, 60, JSON.stringify(payload)).catch(() => {});
    res.status(HTTP_STATUS.OK).json(payload);
  } catch (error) {
    console.error('[getSuperAdminUsers]', error.message);
    res.status(500).json({
      success: false,
      message: 'Error fetching users',
      error: error.message,
    });
  }
};

// Get User by ID
const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .populate('schoolId', 'name code')
      .select('-password');

    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'User not found'
      });
    }

    const [latestThreat, enriched, recentActivity] = await Promise.all([
      calculateUserThreatScore(user._id, user.schoolId).catch(() => null),
      enrichUserForDashboard(user.toObject()),
      UserActivityLog.find({ userId: user._id }).sort({ createdAt: -1 }).limit(20).lean(),
    ]);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: {
        ...enriched,
        ...(latestThreat ? { threatScore: latestThreat.score, riskLevel: latestThreat.riskLevel } : {}),
        recentActivity,
      }
    });
  } catch (error) {
    logger.error('Get user error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error fetching user',
      error: error.message
    });
  }
};

// Update User
const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name, email, mobile, status, role, password,
      gender, dateOfBirth, bloodGroup, address, occupation, city, state, pincode, whatsappNumber,
      employeeId, designation, department, dateOfJoining, qualification,
      experienceYears, previousSchool, subjects,
      monthlySalary, accountNumber, bankName, ifscCode, upiId,
      emergencyContactName, emergencyContactRelation, emergencyContactPhone,
      spouseName, spouseMobile,
    } = req.body;

    // Block password updates
    if (password) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Password updates are not allowed here. Use set-password API.'
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'User not found'
      });
    }

    // Restrict role changes for OPERATOR
    if (role && req.user.role === USER_ROLES.OPERATOR) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'Operators cannot change user roles'
      });
    }

    const fieldsToUpdate = {
      name,
      email,
      mobile,
      status,
      role,
      gender,
      dateOfBirth,
      bloodGroup,
      address,
      occupation,
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
      ...(subjects !== undefined && { subjects }),
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
    };

    Object.keys(fieldsToUpdate).forEach((k) => {
      if (fieldsToUpdate[k] === undefined) delete fieldsToUpdate[k];
    });

    const updatedUser = await User.findByIdAndUpdate(
      id,
      { $set: fieldsToUpdate },
      { new: true, runValidators: true }
    ).select('-password');

    if (!updatedUser) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'User not found'
      });
    }

    logger.success(`User updated: ${user.name} by ${req.user.role}`);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'User updated successfully',
      data: updatedUser
    });
  } catch (error) {
    logger.error('Update user error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error updating user',
      error: error.message
    });
  }
};

// Upload staff document (base64)
const uploadStaffDocument = async (req, res) => {
  try {
    const { id, docType } = req.params;
    const schoolId = req.user.schoolId._id || req.user.schoolId;

    const validTypes = [
      'aadhaarCard',
      'panCard',
      'degreeCertificate',
      'experienceCertificate',
      'staffPhoto',
    ];

    if (!validTypes.includes(docType)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Invalid document type',
      });
    }

    const { fileName, dataUrl } = req.body || {};
    if (!fileName || !dataUrl) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'fileName and dataUrl are required',
      });
    }

    const uploadedAt = new Date();
    const update = {
      [`documents.${docType}.fileName`]: fileName,
      [`documents.${docType}.dataUrl`]: dataUrl,
      [`documents.${docType}.uploadedAt`]: uploadedAt,
    };

    const user = await User.findOneAndUpdate(
      { _id: id, schoolId },
      { $set: update },
      { new: true, runValidators: false }
    ).select('-password');

    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'User not found',
      });
    }

    return res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Document uploaded successfully',
      data: { docType, fileName, uploadedAt },
    });
  } catch (error) {
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message,
    });
  }
};

// Get staff document data (base64)
const getStaffDocumentData = async (req, res) => {
  try {
    const { id, docType } = req.params;
    const schoolId = req.user.schoolId?._id || req.user.schoolId;

    const validTypes = [
      'aadhaarCard',
      'panCard',
      'degreeCertificate',
      'experienceCertificate',
      'staffPhoto',
    ];

    if (!validTypes.includes(docType)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Invalid document type',
      });
    }

    const user = await User.findOne({ _id: id, schoolId }).select(
      `+documents.${docType}.dataUrl documents.${docType}.fileName documents.${docType}.uploadedAt`
    );

    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'User not found',
      });
    }

    const docData = user.documents?.[docType];
    if (!docData?.dataUrl) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Document not found or not uploaded yet',
      });
    }

    return res.status(HTTP_STATUS.OK).json({
      success: true,
      data: {
        docType,
        fileName: docData.fileName,
        uploadedAt: docData.uploadedAt,
        dataUrl: docData.dataUrl,
      },
    });
  } catch (error) {
    logger.error('Get staff document data error:', error.message);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message,
    });
  }
};

// Delete User (Soft Delete)
const deleteUser = async (req, res) => {
  try {
    const requestingUserId = (req.user?._id || req.user?.userId)?.toString();
    if (requestingUserId && requestingUserId === req.params.id) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'You cannot deactivate your own account.'
      });
    }

    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'User not found'
      });
    }

    const targetRole = (user.role || '').toString().toUpperCase();
    const requesterRole = (req.user?.role || '').toString().toUpperCase();
    if (targetRole === USER_ROLES.SUPER_ADMIN && requesterRole !== USER_ROLES.SUPER_ADMIN) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'Only Super Admin can deactivate another Super Admin.'
      });
    }

    // Check if already inactive
    if (user.status === 'inactive' || user.isDeleted) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'User is already deactivated'
      });
    }

    // Soft delete with hard session revocation
    user.status = 'inactive';
    user.isDeleted = true;
    user.deletedAt = new Date();
    user.deletedBy = req.user.userId;
    user.deactivatedAt = new Date();
    user.deactivatedBy = req.user.userId;
    await user.save();

    await LoginSession.updateMany(
      { userId: user._id, isActive: true },
      {
        $set: {
          isActive: false,
          logoutAt: new Date(),
          logoutReason: 'ADMIN_DEACTIVATED',
        },
      }
    );

    await redis.setex(`blacklist:user:${user._id}`, 86400, '1').catch(() => {});
    await _invalidateUserCaches(user._id);

    logger.success(`User deactivated: ${user.name} by ${req.user.role}`);

    // Create audit log
    await auditLog({
      action: 'USER_DELETED',
      userId: req.user.userId,
      schoolId: user.schoolId,
      targetUserId: user._id,
      details: {
        userName: user.name,
        role: user.role,
        deactivatedBy: req.user.role
      },
      req
    });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'User deactivated successfully',
      data: {
        userId: user._id,
        status: user.status,
        deactivatedAt: user.deactivatedAt
      }
    });
  } catch (error) {
    logger.error('Delete user error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error deactivating user',
      error: error.message
    });
  }
};

// Reactivate User
const reactivateUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if already active
    if (user.status === 'active' && !user.isDeleted) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'User is already active'
      });
    }

    // Reactivate user
    user.status = 'active';
    user.isDeleted = false;
    user.deletedAt = null;
    user.deletedBy = null;
    user.deactivatedAt = null;
    user.deactivatedBy = null;
    await user.save();
    await _invalidateUserCaches(user._id);

    logger.success(`User reactivated: ${user.name} by ${req.user.role}`);

    // Create audit log
    await auditLog({
      action: 'USER_UPDATED',
      userId: req.user.userId,
      schoolId: user.schoolId,
      targetUserId: user._id,
      details: {
        userName: user.name,
        action: 'reactivated',
        reactivatedBy: req.user.role
      },
      req
    });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'User reactivated successfully',
      data: {
        userId: user._id,
        status: user.status,
        name: user.name,
        role: user.role
      }
    });
  } catch (error) {
    logger.error('Reactivate user error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error reactivating user',
      error: error.message
    });
  }
};

// Set User Password
const setUserPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;

    // Validate password
    if (!password || password.length < 8) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Password must be at least 8 characters long'
      });
    }

    // Find user with password
    const user = await User.findById(id).select('+password');
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'User not found'
      });
    }

    const requesterRole = (req.user?.role || '').toString().toUpperCase();
    const requesterSchoolId = (
      req.user?.schoolId?._id ||
      req.user?.schoolId ||
      ''
    ).toString();
    const targetSchoolId = (user.schoolId || '').toString();
    const targetRole = (user.role || '').toString().toUpperCase();

    // SUPER_ADMIN can reset all users across schools (existing behavior).
    if (requesterRole === USER_ROLES.PRINCIPAL) {
      if (!requesterSchoolId || !targetSchoolId || requesterSchoolId !== targetSchoolId) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
          success: false,
          message: 'Access denied. Cannot reset password for users from other schools'
        });
      }

      const allowedTargetRoles = [
        USER_ROLES.OPERATOR,
        USER_ROLES.TEACHER,
        USER_ROLES.STUDENT,
        USER_ROLES.PARENT,
      ];
      if (!allowedTargetRoles.includes(targetRole)) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
          success: false,
          message: 'Access denied. Principal can only reset Operator, Teacher, Student, or Parent passwords'
        });
      }
    } else if (requesterRole !== USER_ROLES.SUPER_ADMIN) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'Access denied. Insufficient permissions.'
      });
    }

    // Hash new password
    const hashedPassword = await hashPassword(password);

    // Update password
    user.password = hashedPassword;
    user.lockedUntil = null;
    user.failedLogins = 0;
    await user.save();

    await LoginSession.updateMany(
      { userId: user._id, isActive: true },
      {
        $set: {
          isActive: false,
          logoutAt: new Date(),
          logoutReason: 'PASSWORD_RESET',
        },
      }
    );
    await _invalidateUserCaches(user._id);

    logger.success(`Password reset for user: ${user.name} by ${req.user.role}`);

    // Create audit log
    await auditLog({
      action: 'PASSWORD_RESET',
      category: 'USER',
      userId: req.user.userId,
      userName: req.user.name,
      role: req.user.role,
      entityType: 'USER',
      entityId: user._id,
      entityName: user.name,
      description:
        requesterRole === USER_ROLES.PRINCIPAL
          ? `Principal reset password for ${user.role} ${user.name}`
          : `Password reset for ${user.role} ${user.name}`,
      schoolId: user.schoolId,
      schoolName: req.user?.schoolName || null,
      targetUserId: user._id,
      details: {
        resetBy: req.user.role,
        targetRole: user.role,
        targetName: user.name,
      },
      req
    });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Password reset successfully'
    });
  } catch (error) {
    logger.error('Set user password error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error resetting password',
      error: error.message
    });
  }
};

const changeMyPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body || {};
    const userId = req.user?.userId || req.user?._id || null;

    // Temporary debug metadata logs (no secrets)
    console.log('[changeMyPassword] User ID', userId ? userId.toString() : null);

    if (!currentPassword || typeof currentPassword !== 'string') {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Current password is required',
      });
    }

    if (!newPassword || typeof newPassword !== 'string') {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'New password is required',
      });
    }

    if (!confirmPassword || typeof confirmPassword !== 'string') {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Confirm password is required',
      });
    }

    if (!userId) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const user = await User.findById(userId).select('+password');
    console.log('[changeMyPassword] Loaded User ID', user?._id ? user._id.toString() : null);
    console.log('[changeMyPassword] Password Loaded', !!user?.password);
    console.log('[changeMyPassword] Hash Length', user?.password?.length || 0);
    console.log('[changeMyPassword] Current Password Length', currentPassword?.length || 0);

    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'User not found',
      });
    }

    // Verify current password first (plain text vs stored hash)
    const isMatch = await comparePassword(currentPassword, user.password);
    console.log('[changeMyPassword] Compare Result', isMatch);
    if (!isMatch) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Current password is incorrect',
      });
    }

    if (newPassword.length < 8) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'New password must be at least 8 characters long',
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Confirm password does not match',
      });
    }

    // Hash only the new password after successful current-password verification.
    const schoolBefore = user.schoolId
      ? await School.findById(user.schoolId).select('status plan subscription').lean().catch(() => null)
      : null;
    const fraudBefore = user.schoolId
      ? await FraudAlert.findOne({ schoolId: user.schoolId }).sort({ createdAt: -1 }).select('threatScore createdAt alertType severity').lean().catch(() => null)
      : null;

    user.password = await hashPassword(newPassword);
    user.lockedUntil = null;
    user.failedLogins = 0;
    await user.save();

    const schoolAfter = user.schoolId
      ? await School.findById(user.schoolId).select('status plan subscription').lean().catch(() => null)
      : null;
    const fraudAfter = user.schoolId
      ? await FraudAlert.findOne({ schoolId: user.schoolId }).sort({ createdAt: -1 }).select('threatScore createdAt alertType severity').lean().catch(() => null)
      : null;

    console.log('===== PASSWORD CHANGE FORENSICS =====');
    console.log('Timestamp:', new Date().toISOString());
    console.log('User ID:', userId ? userId.toString() : null);
    console.log('Role:', req.user?.role || null);
    console.log('School ID:', user.schoolId ? user.schoolId.toString() : null);
    console.log('School Status Before:', schoolBefore?.status || null);
    console.log('School Status After:', schoolAfter?.status || null);
    console.log('Fraud Score Before:', fraudBefore?.threatScore ?? null);
    console.log('Fraud Score After:', fraudAfter?.threatScore ?? null);
    console.log('Subscription Status:', schoolAfter?.subscription?.status || schoolBefore?.subscription?.status || null);
    console.log('=============================');

    // Invalidate active sessions and force re-login on all devices.
    await LoginSession.updateMany(
      { userId: user._id, isActive: true },
      {
        $set: {
          isActive: false,
          logoutAt: new Date(),
          forceLoggedOut: true,
          logoutReason: 'PASSWORD_CHANGED',
        },
      }
    );

    // If blacklist checks are enabled, blacklist this user's tokens for the JWT lifespan.
    const ttlSeconds = _jwtExpiryToSeconds(config?.jwt?.expiresIn);
    if (ttlSeconds > 0) {
      await redis.setex(`blacklist:user:${user._id}`, ttlSeconds, '1').catch(() => {});
    }
    await _invalidateUserCaches(user._id);

    await auditLog({
      action: 'PASSWORD_CHANGED',
      category: 'USER',
      userId: userId,
      userName: req.user.name,
      role: req.user.role,
      entityType: 'USER',
      entityId: user._id,
      entityName: user.name,
      description: `${req.user.name} changed own password`,
      schoolId: user.schoolId,
      details: {
        changedBy: req.user.role,
        timestamp: new Date().toISOString(),
        schoolId: user.schoolId ? user.schoolId.toString() : null,
        schoolStatusBefore: schoolBefore?.status || null,
        schoolStatusAfter: schoolAfter?.status || null,
        fraudScoreBefore: fraudBefore?.threatScore ?? null,
        fraudScoreAfter: fraudAfter?.threatScore ?? null,
        fraudSignalBefore: fraudBefore?.alertType || null,
        fraudSignalAfter: fraudAfter?.alertType || null,
        subscriptionStatus: schoolAfter?.subscription?.status || schoolBefore?.subscription?.status || null,
        subscriptionStartDate: schoolAfter?.subscription?.startDate || schoolBefore?.subscription?.startDate || null,
        subscriptionEndDate: schoolAfter?.subscription?.endDate || schoolBefore?.subscription?.endDate || null,
        subscriptionGraceDays: schoolAfter?.subscription?.gracePeriodDays || schoolBefore?.subscription?.gracePeriodDays || null,
      },
      req,
    });

    return res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (error) {
    logger.error('Change my password error:', error.message);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error changing password',
      error: error.message,
    });
  }
};

function _jwtExpiryToSeconds(expiresIn) {
  if (!expiresIn) return 0;
  if (typeof expiresIn === 'number' && expiresIn > 0) return Math.floor(expiresIn);
  if (typeof expiresIn !== 'string') return 0;

  const raw = expiresIn.trim().toLowerCase();
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) return Math.floor(numeric);

  const match = raw.match(/^(\d+)\s*([smhd])$/);
  if (!match) return 0;
  const value = Number(match[1]);
  const unit = match[2];
  const factors = { s: 1, m: 60, h: 3600, d: 86400 };
  return value * (factors[unit] || 0);
}

// Update authenticated user's own profile (email/photo)
const updateMyProfile = async (req, res) => {
  try {
    const { email, photoUrl } = req.body || {};
    const updates = {};

    if (email !== undefined) {
      const normalized = String(email).trim().toLowerCase();
      updates.email = normalized;
    }
    if (photoUrl !== undefined) {
      updates.photoUrl = photoUrl;
    }

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { $set: updates },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'User not found'
      });
    }

    return res.status(HTTP_STATUS.OK).json({
      success: true,
      data: user,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(HTTP_STATUS.CONFLICT).json({
        success: false,
        message: 'Email already exists'
      });
    }
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message,
    });
  }
};

const forceLogoutUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('_id schoolId name');
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ success: false, message: 'User not found' });
    }

    const logoutResult = await LoginSession.updateMany(
      { userId: user._id, isActive: true },
      {
        $set: {
          isActive: false,
          logoutAt: new Date(),
          logoutReason: 'FORCE_LOGOUT',
        },
      }
    );

    await redis.setex(`blacklist:user:${user._id}`, 3600, '1').catch(() => {});
    await _invalidateUserCaches(user._id);

    await auditLog({
      action: 'USER_UPDATED',
      userId: req.user.userId,
      schoolId: user.schoolId,
      targetUserId: user._id,
      details: { action: 'force_logout', affectedSessions: logoutResult.modifiedCount || 0 },
      req,
    });

    return res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'User forcefully logged out',
      data: {
        userId: user._id,
        affectedSessions: logoutResult.modifiedCount || 0,
      },
    });
  } catch (error) {
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error forcing logout',
      error: error.message,
    });
  }
};

const enableMfa = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: { mfaEnabled: true } },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ success: false, message: 'User not found' });
    }

    await _invalidateUserCaches(user._id);
    return res.status(HTTP_STATUS.OK).json({ success: true, message: 'MFA enabled', data: user });
  } catch (error) {
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  }
};

const disableMfa = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: { mfaEnabled: false, mfaSecret: null } },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ success: false, message: 'User not found' });
    }

    await _invalidateUserCaches(user._id);
    return res.status(HTTP_STATUS.OK).json({ success: true, message: 'MFA disabled', data: user });
  } catch (error) {
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  }
};

const getUserAnalytics = async (req, res) => {
  try {
    const cacheKey = 'users:analytics:summary';
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) {
      return res.status(HTTP_STATUS.OK).json(JSON.parse(cached));
    }

    const [allUsers, activeSessions, mfaEnabledUsers, apiAccessUsers, deletedUsers] = await Promise.all([
      User.find({ isDeleted: { $ne: true } }).select('_id threatScore riskLevel').lean(),
      LoginSession.countDocuments({ isActive: true }),
      User.countDocuments({ mfaEnabled: true, isDeleted: { $ne: true } }),
      User.countDocuments({ apiAccess: true, isDeleted: { $ne: true } }),
      User.countDocuments({ isDeleted: true }),
    ]);

    const highThreatUsers = allUsers.filter((u) => (u.riskLevel || 'LOW') === 'HIGH').length;
    const mediumThreatUsers = allUsers.filter((u) => (u.riskLevel || 'LOW') === 'MEDIUM').length;

    const payload = {
      success: true,
      data: {
        totalUsers: allUsers.length,
        activeSessions,
        mfaEnabledUsers,
        apiAccessUsers,
        highThreatUsers,
        mediumThreatUsers,
        deletedUsers,
      },
    };

    await redis.setex(cacheKey, 120, JSON.stringify(payload)).catch(() => {});
    return res.status(HTTP_STATUS.OK).json(payload);
  } catch (error) {
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  }
};

const _buildUserMetrics = (users, totalUsers) => ({
  totalUsers,
  activeUsers: users.filter((u) => u.status === 'active').length,
  inactiveUsers: users.filter((u) => u.status !== 'active').length,
  highThreatUsers: users.filter((u) => u.riskLevel === 'HIGH').length,
  mediumThreatUsers: users.filter((u) => u.riskLevel === 'MEDIUM').length,
  mfaEnabledUsers: users.filter((u) => u.mfaEnabled).length,
  apiAccessUsers: users.filter((u) => u.apiAccess).length,
  totalFailedLogins: users.reduce((sum, u) => sum + (u.failedLogins || 0), 0),
  roleBreakdown: {
    SUPER_ADMIN: users.filter((u) => u.role === 'SUPER_ADMIN').length,
    PRINCIPAL: users.filter((u) => u.role === 'PRINCIPAL').length,
    OPERATOR: users.filter((u) => u.role === 'OPERATOR').length,
    TEACHER: users.filter((u) => u.role === 'TEACHER').length,
    STUDENT: users.filter((u) => u.role === 'STUDENT').length,
    PARENT: users.filter((u) => u.role === 'PARENT').length,
  },
});

async function _invalidateUserCaches(userId) {
  await Promise.all([
    redis.del('users:analytics:summary').catch(() => {}),
    redis.del(`threat:user:${userId}`).catch(() => {}),
  ]);

  const keys = await redis.keys('users:dashboard:*').catch(() => []);
  if (keys && keys.length) {
    await Promise.all(keys.map((key) => redis.del(key).catch(() => {})));
  }
}

module.exports = {
  createUser,
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  reactivateUser,
  setUserPassword,
  changeMyPassword,
  updateMyProfile,
  uploadStaffDocument,
  getStaffDocumentData,
  getSuperAdminUsers,
  forceLogoutUser,
  enableMfa,
  disableMfa,
  getUserAnalytics,
};
