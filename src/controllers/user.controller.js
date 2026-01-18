const User = require('../models/User.js');
const School = require('../models/School.js');
const { hashPassword } = require('../utils/password.js');
const { HTTP_STATUS, USER_ROLES } = require('../config/constants.js');
const { logger } = require('../utils/logger.js');
const { auditLog } = require('../utils/auditLog_new.js');

// Create User
const createUser = async (req, res) => {
  try {
    const { name, email, mobile, password, role, status } = req.body;
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
      status: status || 'active'
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
    const { name, email, mobile, status, role, password } = req.body;

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

    // Update fields
    if (name) user.name = name;
    if (email) user.email = email;
    if (mobile) user.mobile = mobile;
    if (status) user.status = status;
    if (role) user.role = role;

    await user.save();

    logger.success(`User updated: ${user.name} by ${req.user.role}`);

    const userResponse = user.toObject();
    delete userResponse.password;

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'User updated successfully',
      data: userResponse
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

module.exports = {
  createUser,
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  reactivateUser,
  setUserPassword
};
