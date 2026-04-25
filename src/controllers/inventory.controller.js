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
    const { role } = req.user;

    // schoolId can come from req.user.schoolId (string from JWT)
    // OR req.schoolId (set by attachSchoolId middleware)
    // Use whichever is available
    const rawSchoolId = req.user.schoolId || req.schoolId;

    console.log('[INVENTORY] role:', role);
    console.log('[INVENTORY] rawSchoolId:', rawSchoolId);
    console.log('[INVENTORY] req.user:', JSON.stringify(req.user));

    if (![USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR].includes(role)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'Access denied. Principal or Operator only.'
      });
    }

    if (!rawSchoolId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'School ID missing from your session. Please log out and log in again.'
      });
    }

    // Safe ObjectId conversion — handles string, ObjectId, or invalid value
    let schoolObjId;
    try {
      schoolObjId = new mongoose.Types.ObjectId(rawSchoolId.toString());
    } catch (e) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: `Invalid school ID format: ${rawSchoolId}`,
      });
    }

    console.log('[INVENTORY] schoolObjId:', schoolObjId);

    // ── Fetch students ──────────────────────────────────────────────
    let students = [];
    try {
      students = await Student.find({ schoolId: schoolObjId })
        .populate('classId', 'name')
        .populate('sectionId', 'name')
        .populate({
          path: 'parentId',
          select: 'userId status',
          populate: {
            path: 'userId',
            select: 'name email mobile gender address'
          }
        })
        .populate('userId', 'mobile email')
        .lean();
      console.log('[INVENTORY] students found:', students.length);
    } catch (e) {
      console.error('[INVENTORY] student query error:', e.message);
      // Don't crash — continue with empty students
    }

    // ── Fetch staff ─────────────────────────────────────────────────
    let staff = [];
    try {
      staff = await User.find({
        schoolId: schoolObjId,
        role: {
          $in: [
            USER_ROLES.TEACHER,
            USER_ROLES.OPERATOR,
            USER_ROLES.PRINCIPAL,
          ]
        },
        status: 'active',
      })
      .select('-password -documents')
      .lean();
      console.log('[INVENTORY] staff found:', staff.length);
    } catch (e) {
      console.error('[INVENTORY] staff query error:', e.message);
    }

    // ── Fetch physical inventory ─────────────────────────────────────
    let inventoryItems = [];
    try {
      inventoryItems = await Inventory.find({
        schoolId: schoolObjId
      }).lean();
      console.log('[INVENTORY] inventory items:', inventoryItems.length);
    } catch (e) {
      console.error('[INVENTORY] inventory query error:', e.message);
    }

    // ── Audit log (non-blocking) ─────────────────────────────────────
    try {
      await auditLog({
        action: 'INVENTORY_EXPORTED',
        entityType: 'INVENTORY',
        userId: req.user.userId || req.user._id,
        role,
        schoolId: rawSchoolId,
        details: {
          students: students.length,
          staff: staff.length,
          inventoryItems: inventoryItems.length,
        },
        req,
      });
    } catch (e) {
      console.error('[INVENTORY] audit log error:', e.message);
      // Never block export due to audit failure
    }

    logger.success(
      `School export OK: ${students.length} students, ` +
      `${staff.length} staff, ${inventoryItems.length} items`
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
    console.error('[INVENTORY EXPORT] Unexpected error:', error);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error exporting school data',
      error: error.message,
    });
  }
};

module.exports = { exportInventoryController };
