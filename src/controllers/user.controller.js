const User = require('../models/User.js');
const School = require('../models/School.js');
const { hashPassword } = require('../utils/password.js');
const { HTTP_STATUS, USER_ROLES } = require('../config/constants.js');
const { logger } = require('../utils/logger.js');
const { auditLog } = require('../utils/auditLog.js');

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

    // Create audit log
    await auditLog({
      action: 'USER_CREATED',
      userId: req.user.userId,
      schoolId: user.schoolId,
      targetUserId: user._id,
      details: { role: user.role, email, mobile },
      req
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

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: user
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

// Delete User (Soft Delete)
const deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if already inactive
    if (user.status === 'inactive') {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'User is already deactivated'
      });
    }

    // Soft delete: set status to inactive
    user.status = 'inactive';
    user.deactivatedAt = new Date();
    user.deactivatedBy = req.user.userId;
    await user.save();

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
    if (user.status === 'active') {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'User is already active'
      });
    }

    // Reactivate user
    user.status = 'active';
    user.deactivatedAt = null;
    user.deactivatedBy = null;
    await user.save();

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
    if (!password || password.length < 6) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Password must be at least 6 characters long'
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

    // School-level safety check
    if (user.schoolId && user.schoolId.toString() !== req.user.schoolId && req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'Access denied. Cannot reset password for users from other schools'
      });
    }

    // Hash new password
    const hashedPassword = await hashPassword(password);

    // Update password
    user.password = hashedPassword;
    await user.save();

    logger.success(`Password reset for user: ${user.name} by ${req.user.role}`);

    // Create audit log
    await auditLog({
      action: 'PASSWORD_RESET',
      userId: req.user.userId,
      schoolId: user.schoolId,
      targetUserId: user._id,
      details: { resetBy: req.user.role },
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

module.exports = {
  createUser,
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  reactivateUser,
  setUserPassword,
  updateMyProfile,
  uploadStaffDocument
};
