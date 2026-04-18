const express = require('express');
const { saveArrangement, getArrangement } = require('../controllers/seatingArrangement.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/role.middleware');

const router = express.Router();

router.use(authenticate);
router.post('/', requireRole('PRINCIPAL', 'OPERATOR'), saveArrangement);
router.get('/:examId', requireRole('PRINCIPAL', 'OPERATOR', 'TEACHER'), getArrangement);

router.get(
	'/my/:examId',
	requireRole('STUDENT', 'PARENT'),
	async (req, res) => {
		try {
			const { examId } = req.params;
			const { schoolId, sessionId } = req.user;
			const userId = req.user.userId || req.user._id;

			const Exam = require('../models/Exam');
			const exam = await Exam.findById(examId);
			if (!exam?.isAdmitCardPublished) {
				return res.status(403).json({ success: false, message: 'Seating not yet released' });
			}

			const Student = require('../models/Student');
			const student = await Student.findOne({ userId, schoolId });
			if (!student) {
				return res.status(404).json({ success: false, message: 'Student not found' });
			}

			const SeatingArrangement = require('../models/SeatingArrangement');
			const arrangement = await SeatingArrangement.findOne({ examId, schoolId, sessionId }).lean();
			if (!arrangement) {
				return res.status(404).json({ success: false, message: 'No seating arrangement' });
			}

			let studentSeat = null;
			for (const hall of arrangement.halls || []) {
				const seat = (hall.seats || []).find(
					(s) => s.studentId?.toString() === student._id.toString()
				);
				if (seat) {
					studentSeat = {
						hallName: hall.name,
						seatLabel: seat.seatLabel,
						row: seat.row,
						col: seat.col,
					};
					break;
				}
			}

			res.json({ success: true, data: studentSeat });
		} catch (err) {
			res.status(500).json({ success: false, message: err.message });
		}
	}
);

module.exports = router;
