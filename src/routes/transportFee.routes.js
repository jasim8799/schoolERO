const express = require('express');
const { authenticate } = require('../middlewares/auth.middleware.js');
const { enforceSchoolIsolation } = require('../middlewares/school.middleware.js');
const { requireRole } = require('../middlewares/role.middleware.js');
const { getAllFees, payFee } = require('../controllers/transportFee.controller.js');
const { USER_ROLES } = require('../config/constants.js');
const Student = require('../models/Student');
const Parent = require('../models/Parent');
const Bill = require('../models/Bill');

const router = express.Router();

router.get('/', authenticate, enforceSchoolIsolation, getAllFees);
router.get('/student/me', authenticate, enforceSchoolIsolation,
  requireRole(USER_ROLES.STUDENT, USER_ROLES.PARENT), async (req, res) => {
    try {
      const { schoolId, _id: userId, role } = req.user;
      const { childId } = req.query;
      let studentId;

      if (role === USER_ROLES.STUDENT) {
        const student = await Student.findOne({ userId, schoolId }).select('_id');
        if (!student) return res.json({ success: true, data: [] });
        studentId = student._id;
      } else if (role === USER_ROLES.PARENT) {
        const parent = await Parent.findOne({ userId, schoolId }).populate('children', '_id');
        const children = parent?.children || [];
        if (!children.length) return res.json({ success: true, data: [] });

        const selectedChildId = childId || children[0]?._id?.toString();
        const hasAccess = children.some(c => c?._id?.toString() === selectedChildId);
        if (!hasAccess) return res.status(403).json({ success: false, message: 'Forbidden' });
        studentId = selectedChildId;
      } else {
        return res.status(403).json({ success: false, message: 'Forbidden' });
      }

      const bills = await Bill.find({ studentId, schoolId, billType: 'TRANSPORT' })
        .sort({ createdAt: -1 })
        .lean();

      return res.json({ success: true, data: bills });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);
router.post('/pay', authenticate, enforceSchoolIsolation,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR), payFee);

module.exports = router;
