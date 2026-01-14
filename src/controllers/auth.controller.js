import User from '../models/User.js';
import { hashPassword, comparePassword } from '../utils/password.js';
import { generateToken } from '../utils/jwt.js';
import { HTTP_STATUS, USER_ROLES } from '../config/constants.js';
import { logger } from '../utils/logger.js';
import { createAuditLog } from '../utils/auditLog.js';

// Register User
export const register = async (req, res) => {
  try {
    const { name, email, mobile, password, role, schoolId } = req.body;

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

    // Validate schoolId for non-SUPER_ADMIN roles
    if (role !== USER_ROLES.SUPER_ADMIN && !schoolId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'School ID is required for this role'
      });
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
      schoolId: role === USER_ROLES.SUPER_ADMIN ? null : schoolId
    });

    logger.success(`User registered: ${user.name} (${user.role})`);

    // Remove password from response
    const userResponse = user.toObject();
    delete userResponse.password;

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: 'User registered successfully',
      data: userResponse
    });
  } catch (error) {
    logger.error('Register error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error registering user',
      error: error.message
    });
  }
};

// Login User
export const login = async (req, res) => {
  try {
    const { email, mobile, password } = req.body;

    // Validate required fields
    if ((!email && !mobile) || !password) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Email/mobile and password are required'
      });
    }

    // Find user by email or mobile
    const user = await User.findOne({
      $or: [
        ...(email ? [{ email }] : []),
        ...(mobile ? [{ mobile }] : [])
      ]
    }).select('+password').populate('schoolId', 'name code status');

    if (!user) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if user is active
    if (user.status !== 'active') {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'User account is inactive'
      });
    }

    // Check if user's school is active (for non-SUPER_ADMIN users)
    if (user.role !== USER_ROLES.SUPER_ADMIN && user.schoolId && user.schoolId.status !== 'active') {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'School is currently inactive. Please contact system administrator.'
      });
    }

    // Compare password
    const isPasswordValid = await comparePassword(password, user.password);
    if (!isPasswordValid) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Generate JWT token
    const token = generateToken({
      userId: user._id,
      role: user.role,
      schoolId: user.schoolId?._id || null
    });

    logger.success(`User logged in: ${user.name} (${user.role})`);

    // Create audit log for login
    await createAuditLog({
      action: 'LOGIN',
      userId: user._id,
      schoolId: user.schoolId?._id || null,
      details: { email, mobile },
      req
    });

    // Remove password from response
    const userResponse = user.toObject();
    delete userResponse.password;

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Login successful',
      data: {
        user: userResponse,
        token
      }
    });
  } catch (error) {
    logger.error('Login error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error logging in',
      error: error.message
    });
  }
};

// Get Current User
export const getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId)
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
    logger.error('Get current user error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error fetching user',
      error: error.message
    });
  }
};
