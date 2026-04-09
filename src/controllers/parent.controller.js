const Parent = require('../models/Parent.js');
const User = require('../models/User.js');
const Student = require('../models/Student.js');
const { HTTP_STATUS, USER_ROLES } = require('../config/constants.js');
const { logger } = require('../utils/logger.js');
const { auditLog } = require('../utils/auditLog.js');

// Create Parent
const createParent = async (req, res) => {
  try {
    const { userId, whatsappNumber } = req.body;
    const schoolId = req.user.schoolId?._id || req.user.schoolId;

    // Validate required fields
    if (!userId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'userId is required'
      });
    }

    // Verify user exists, is a PARENT, and belongs to the school
    const user = await User.findOne({ _id: userId, role: USER_ROLES.PARENT, schoolId });
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'User not found or is not a PARENT in this school'
      });
    }

    // Update whatsappNumber if provided
    if (whatsappNumber !== undefined) {
      await User.findByIdAndUpdate(userId, { whatsappNumber });
    }

    // Check if parent profile already exists
    const existingParent = await Parent.findOne({ userId, schoolId });
    if (existingParent) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Parent profile already exists for this user in this school'
      });
    }

    // Create parent (children will be empty initially)
    const newParent = await Parent.create({
      userId,
      children: [],
      schoolId,
      status: 'active'
    });

    // ✅ Backfill existing students linked to this parent
    const students = await Student.find({
      parentUserId: userId,
      schoolId
    });

    if (students.length) {
      newParent.children = students.map(s => s._id);
      await newParent.save();
    }

    // Audit log
    await auditLog({
      action: 'PARENT_CREATED',
      userId: req.user.userId,
      schoolId,
      details: { parentUserId: userId, parentId: newParent._id }
    });

    logger.success(`Parent profile created for user ${userId} (${user.name})`);

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: 'Parent profile created successfully',
      data: newParent
    });
  } catch (error) {
    logger.error('Create parent error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error creating parent profile',
      error: error.message
    });
  }
};

// Get All Parents
const getAllParents = async (req, res) => {
  try {
    const { schoolId } = req.query;

    // Build filter
    const filter = {};
    if (schoolId) filter.schoolId = schoolId;

    const parents = await Parent.find(filter)
      .populate(
        'userId',
        'name email mobile whatsappNumber address occupation emergencyContactName emergencyContactPhone status'
      )
      .populate('schoolId', 'name code')
      .populate({
        path: 'children',
        select: 'name rollNumber classId',
        populate: { path: 'classId', select: 'name' }
      })
      .sort({ createdAt: -1 });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      count: parents.length,
      data: parents
    });
  } catch (error) {
    logger.error('Get parents error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error retrieving parents',
      error: error.message
    });
  }
};

// Get Parent by ID
const getParentById = async (req, res) => {
  try {
    const { id } = req.params;

    const parent = await Parent.findById(id)
      .populate('userId', 'name email')
      .populate('schoolId', 'name code')
      .populate({
        path: 'children',
        select: 'name rollNumber classId sectionId',
        populate: [
          { path: 'classId', select: 'name' },
          { path: 'sectionId', select: 'name' }
        ]
      });

    if (!parent) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Parent not found'
      });
    }

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: parent
    });
  } catch (error) {
    logger.error('Get parent error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error retrieving parent',
      error: error.message
    });
  }
};

// Get Current Parent's Children
const getMyChildren = async (req, res) => {
  try {
    const { userId, schoolId } = req.user;
    const normalizedSchoolId = schoolId?._id || schoolId;

    const parent = await Parent.findOne({ userId, schoolId: normalizedSchoolId })
      .populate({
        path: 'children',
        select: 'name rollNumber classId sectionId documents',
        populate: [
          { path: 'classId', select: 'name' },
          { path: 'sectionId', select: 'name' }
        ]
      });

    if (!parent) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Parent profile not found'
      });
    }

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: parent.children
    });
  } catch (error) {
    logger.error('Get my children error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error retrieving children',
      error: error.message
    });
  }
};

// Update Parent + link/unlink students
const updateParent = async (req, res) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.schoolId?._id || req.user.schoolId;
    const {
      name,
      mobile,
      email,
      whatsappNumber,
      address,
      occupation,
      emergencyContactName,
      emergencyContactPhone,
      addStudentIds,
      removeStudentIds,
    } = req.body;

    const parent = await Parent.findOne({ _id: id, schoolId });
    if (!parent) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Parent not found'
      });
    }

    const userUpdates = {};
    if (name !== undefined) userUpdates.name = name;
    if (mobile !== undefined) userUpdates.mobile = mobile;
    if (email !== undefined) {
      userUpdates.email = email ? email.toLowerCase().trim() : null;
    }
    if (whatsappNumber !== undefined) userUpdates.whatsappNumber = whatsappNumber;
    if (address !== undefined) userUpdates.address = address;
    if (occupation !== undefined) userUpdates.occupation = occupation;
    if (emergencyContactName !== undefined) {
      userUpdates.emergencyContactName = emergencyContactName;
    }
    if (emergencyContactPhone !== undefined) {
      userUpdates.emergencyContactPhone = emergencyContactPhone;
    }

    if (Object.keys(userUpdates).length > 0) {
      await User.findByIdAndUpdate(parent.userId, { $set: userUpdates });
    }

    if (Array.isArray(addStudentIds) && addStudentIds.length > 0) {
      for (const studentId of addStudentIds) {
        const student = await Student.findOne({ _id: studentId, schoolId });
        if (!student) continue;

        if (!parent.children.some(c => c.toString() === studentId.toString())) {
          parent.children.push(studentId);
        }

        await Student.findByIdAndUpdate(studentId, {
          parentId: parent._id,
          parentUserId: parent.userId,
        });
      }
    }

    if (Array.isArray(removeStudentIds) && removeStudentIds.length > 0) {
      const removeSet = new Set(removeStudentIds.map(idToRemove => idToRemove.toString()));
      parent.children = parent.children.filter(
        childId => !removeSet.has(childId.toString())
      );

      await Student.updateMany(
        { _id: { $in: removeStudentIds }, schoolId },
        { $unset: { parentId: '', parentUserId: '' } }
      );
    }

    await parent.save();

    const updatedParent = await Parent.findById(id)
      .populate(
        'userId',
        'name email mobile whatsappNumber address occupation emergencyContactName emergencyContactPhone status'
      )
      .populate({
        path: 'children',
        select: 'name rollNumber classId',
        populate: { path: 'classId', select: 'name' }
      });

    return res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Parent updated',
      data: updatedParent
    });
  } catch (error) {
    logger.error('updateParent error:', error.message);
    if (error.code === 11000) {
      return res.status(HTTP_STATUS.CONFLICT).json({
        success: false,
        message: 'Mobile or email already in use'
      });
    }
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message
    });
  }
};

// TEMPORARY ADMIN-ONLY MIGRATION: Backfill parentUserId for existing students
const migrateParentUserId = async (req, res) => {
  try {
    // Only allow SUPER_ADMIN
    if (req.user.role !== 'SUPER_ADMIN') {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'Forbidden: Only SUPER_ADMIN can run migrations'
      });
    }

    const students = await Student.find({
      parentUserId: { $exists: false }
    }).populate({
      path: 'parentId',
      select: 'userId'
    });

    let updatedCount = 0;
    for (const student of students) {
      if (student.parentId?.userId) {
        student.parentUserId = student.parentId.userId;
        await student.save();
        updatedCount++;
      }
    }

    logger.success(`Migration completed: ${updatedCount} students updated with parentUserId`);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: `Migration completed successfully`,
      data: { updatedStudents: updatedCount }
    });
  } catch (error) {
    logger.error('Migration error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Migration failed',
      error: error.message
    });
  }
};

module.exports = {
  createParent,
  getAllParents,
  getParentById,
  getMyChildren,
  updateParent,
  migrateParentUserId
};
