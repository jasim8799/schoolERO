const express = require('express');
const { payHostelFee, getHostelFeeHistory } = require('../controllers/hostelFee.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/role.middleware');
const Student = require('../models/Student');
const Parent = require('../models/Parent');
const Bill = require('../models/Bill');
const Payment = require('../models/Payment');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

router.use(authenticate);
router.post('/pay', requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR), payHostelFee);
router.get('/', requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR), getHostelFeeHistory);

router.get('/student/me', requireRole(USER_ROLES.STUDENT, USER_ROLES.PARENT), async (req, res) => {
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
			const hasAccess = children.some((c) => c?._id?.toString() === selectedChildId);
			if (!hasAccess) {
				return res.status(403).json({ success: false, message: 'Forbidden' });
			}
			studentId = selectedChildId;
		} else {
			return res.status(403).json({ success: false, message: 'Forbidden' });
		}

		const bills = await Bill.find({
			studentId,
			schoolId,
			billType: 'HOSTEL',
			sourceType: { $ne: 'Admission' },
		})
			.populate('studentId', 'name rollNumber')
			.sort({ createdAt: -1 })
			.lean();

		const billsWithPayments = await Promise.all(bills.map(async (bill) => {
			const payments = await Payment.find({ billId: bill._id })
				.select('amount paymentDate paymentMode receiptNumber')
				.sort({ paymentDate: -1 })
				.lean();

			return { ...bill, payments, isPaid: bill.status === 'PAID' };
		}));

		return res.json({ success: true, data: billsWithPayments });
	} catch (err) {
		return res.status(500).json({ success: false, message: err.message });
	}
});

module.exports = router;
