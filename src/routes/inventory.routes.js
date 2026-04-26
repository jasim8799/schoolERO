const express = require('express');
const { exportInventoryController } = require('../controllers/inventory.controller');
const mongoose = require('mongoose');
const Teacher = require('../models/Teacher');
const User = require('../models/User');

const router = express.Router();

// DEBUG route — remove after fixing
router.get('/debug', async (req, res) => {
	try {
		const rawSchoolId = req.user?.schoolId || req.schoolId;
		console.log('[DEBUG] rawSchoolId:', rawSchoolId);
		console.log('[DEBUG] req.user:', JSON.stringify(req.user));

		if (!rawSchoolId) {
			return res.json({ error: 'No schoolId found', user: req.user });
		}

		const schoolObjId = new mongoose.Types.ObjectId(rawSchoolId.toString());

		// Count teachers with different filters
		const teacherTotal = await Teacher.countDocuments({
			schoolId: schoolObjId
		});
		const teacherActive = await Teacher.countDocuments({
			schoolId: schoolObjId, status: 'active'
		});
		const teacherAny = await Teacher.countDocuments({});

		// Sample teacher to see actual data
		const sampleTeacher = await Teacher.findOne({
			schoolId: schoolObjId
		}).lean();

		// Sample teacher without schoolId filter
		const anyTeacher = await Teacher.findOne({}).lean();

		// Users with TEACHER role
		const teacherUsers = await User.countDocuments({
			schoolId: schoolObjId,
			role: 'TEACHER'
		});

		// Operators
		const operators = await User.countDocuments({
			schoolId: schoolObjId,
			role: 'OPERATOR',
			status: 'active'
		});

		return res.json({
			rawSchoolId,
			schoolObjId: schoolObjId.toString(),
			teacherTotal,
			teacherActive,
			teacherAny,
			teacherUsers,
			operators,
			sampleTeacher: sampleTeacher ? {
				_id: sampleTeacher._id,
				schoolId: sampleTeacher.schoolId,
				status: sampleTeacher.status,
				hasUserId: !!sampleTeacher.userId,
			} : null,
			anyTeacher: anyTeacher ? {
				_id: anyTeacher._id,
				schoolId: anyTeacher.schoolId,
				status: anyTeacher.status,
			} : null,
		});
	} catch (e) {
		return res.json({ error: e.message, stack: e.stack });
	}
});

// Main export route
router.get('/export', exportInventoryController);

module.exports = router;
