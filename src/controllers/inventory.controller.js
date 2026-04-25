const { HTTP_STATUS, USER_ROLES } = require('../config/constants.js');
const { logger } = require('../utils/logger.js');
const { auditLog } = require('../utils/auditLog.js');
const Student = require('../models/Student.js');
const User = require('../models/User.js');
const mongoose = require('mongoose');

const exportInventoryController = async (req, res) => {
  try {
    const { role, schoolId } = req.user;

    if (![USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR].includes(role)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'Access denied. Principal or Operator only.'
      });
    }

    const schoolObjId = new mongoose.Types.ObjectId(schoolId);

    // Fetch students with populated class/section/parent
    const students = await Student.find({ schoolId: schoolObjId })
      .populate('classId', 'name')
      .populate('sectionId', 'name')
      .populate('parentId', 'fatherName motherName mobile email address')
      .populate('userId', 'mobile email')
      .lean();

    // Fetch staff (TEACHER, OPERATOR, PRINCIPAL)
    const staff = await User.find({
      schoolId: schoolObjId,
      role: { $in: ['TEACHER', 'OPERATOR', 'PRINCIPAL'] },
      status: 'active'
    })
      .select('-password -documents')
      .lean();

    await auditLog({
      action: 'INVENTORY_EXPORTED',
      entityType: 'INVENTORY',
      userId: req.user.userId || req.user._id,
      role,
      schoolId,
      details: { students: students.length, staff: staff.length },
      req,
    });

    logger.success(`School data export: ${students.length} students, ${staff.length} staff`);

    return res.status(HTTP_STATUS.OK).json({
      success: true,
      data: {
        students,
        staff,
        summary: {
          totalStudents: students.length,
          activeStudents: students.filter((s) => s.status === 'ACTIVE').length,
          totalStaff: staff.length,
          teachers: staff.filter((s) => s.role === 'TEACHER').length,
        }
      },
      exportedAt: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('Export inventory error:', error.message);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error exporting school data',
      error: error.message
    });
  }
};

module.exports = { exportInventoryController };
