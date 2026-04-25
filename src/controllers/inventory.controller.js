const { HTTP_STATUS, USER_ROLES } = require('../config/constants.js');
const { logger } = require('../utils/logger.js');
const { auditLog } = require('../utils/auditLog.js');
const Student = require('../models/Student.js');
const User = require('../models/User.js');
const Parent = require('../models/Parent.js');
const Inventory = require('../models/Inventory.js');
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

    // ── BUG 1 FIX: Parent has no name/mobile fields — those are on User.
    // Populate parentId → get userId from Parent → then get User fields.
    // Solution: populate parentId (gets userId), then get parent Users separately.

    const students = await Student.find({ schoolId: schoolObjId })
      .populate('classId', 'name')
      .populate('sectionId', 'name')
      .populate({
        path: 'parentId',
        select: 'userId status',           // Parent only has userId
        populate: {
          path: 'userId',                  // Nested populate to get User fields
          select: 'name email mobile gender address occupation'
        }
      })
      .populate('userId', 'mobile email')  // Student's own User record
      .lean();

    // ── BUG 2 FIX: USER_STATUS.ACTIVE = 'active' (lowercase)
    // Staff query must use 'active' not 'ACTIVE'
    const staff = await User.find({
      schoolId: schoolObjId,
      role: { $in: [
        USER_ROLES.TEACHER,    // 'TEACHER'
        USER_ROLES.OPERATOR,   // 'OPERATOR'
        USER_ROLES.PRINCIPAL,  // 'PRINCIPAL'
      ]},
      status: 'active',        // ← FIX: was wrong casing before
    })
    .select('-password -documents')
    .lean();

    // ── BUG 3 FIX: Also export physical Inventory items (they exist in DB)
    // Even if empty now, include so the CSV has the sheet ready
    const inventoryItems = await Inventory.find({ schoolId: schoolObjId }).lean();

    await auditLog({
      action: 'INVENTORY_EXPORTED',
      entityType: 'INVENTORY',
      userId: req.user.userId || req.user._id,
      role,
      schoolId,
      details: {
        students: students.length,
        staff: staff.length,
        inventoryItems: inventoryItems.length,
      },
      req,
    });

    logger.success(
      `School export: ${students.length} students, ` +
      `${staff.length} staff, ${inventoryItems.length} inventory items`
    );

    return res.status(HTTP_STATUS.OK).json({
      success: true,
      data: {
        students,
        staff,
        inventoryItems,
        summary: {
          totalStudents:    students.length,
          activeStudents:   students.filter(s => s.status === 'ACTIVE').length,
          inactiveStudents: students.filter(s => s.status !== 'ACTIVE').length,
          totalStaff:       staff.length,
          teachers:         staff.filter(s => s.role === USER_ROLES.TEACHER).length,
          operators:        staff.filter(s => s.role === USER_ROLES.OPERATOR).length,
          inventoryItems:   inventoryItems.length,
        }
      },
      exportedAt: new Date().toISOString(),
    });

  } catch (error) {
    // Log full error server-side so you can see it in Render logs
    logger.error('Export inventory error:', error.message);
    console.error('[INVENTORY EXPORT] Full error:', error);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error exporting school data',
      error: error.message,        // ← now visible in Flutter snackbar
      stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined,
    });
  }
};

module.exports = { exportInventoryController };
