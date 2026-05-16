const express = require('express');
const {
  saveArrangement,
  getArrangement,
  listArrangements,
  deleteArrangement,
} = require('../controllers/seatingArrangement.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/role.middleware');
const { enforceSchoolIsolation } = require('../middlewares/school.middleware');
const { attachActiveSession } = require('../middlewares/session.middleware');

const router = express.Router();
router.use(authenticate);
router.use(attachActiveSession);
router.use(enforceSchoolIsolation);

// Principal/Operator: save arrangement (POST creates or updates)
router.post(
  '/',
  requireRole('PRINCIPAL', 'OPERATOR'),
  saveArrangement
);

// Get list of all arrangements for an exam (all dates)
router.get(
  '/:examId/list',
  requireRole('PRINCIPAL', 'OPERATOR', 'TEACHER'),
  listArrangements
);

// Delete an arrangement by ID
router.delete(
  '/arrangement/:arrangementId',
  requireRole('PRINCIPAL', 'OPERATOR'),
  deleteArrangement
);

// Get arrangement for exam (GET /api/seating-arrangements/:examId?date=YYYY-MM-DD)
router.get(
  '/:examId',
  requireRole('PRINCIPAL', 'OPERATOR', 'TEACHER'),
  getArrangement
);

// Student/Parent: get their own seat
router.get(
  '/my/:examId',
  requireRole('STUDENT', 'PARENT'),
  async (req, res) => {
    try {
      const { examId } = req.params;
      const { schoolId, sessionId } = req.user;
      const userId = req.user.userId || req.user._id;

      const exam = await require('../models/Exam').findById(examId);
      if (!exam?.isAdmitCardPublished) {
        return res.status(403).json({
          success: false,
          message: 'Seating not yet released'
        });
      }

      const Student = require('../models/Student');
      const student = await Student.findOne({ userId, schoolId });
      if (!student) {
        return res.status(404).json({
          success: false,
          message: 'Student not found'
        });
      }

      // Get today's date arrangement or default
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      let arrangement = await SeatingArrangement.findOne({
        examId, schoolId, sessionId, date: today
      }).lean();

      if (!arrangement) {
        // Fall back to default (date: null)
        arrangement = await SeatingArrangement.findOne({
          examId, schoolId, sessionId, date: null
        }).lean();
      }

      if (!arrangement) {
        return res.status(404).json({
          success: false,
          message: 'No seating arrangement found'
        });
      }

      let studentSeat = null;
      for (const hall of arrangement.halls || []) {
        for (const seat of hall.seats || []) {
          const found = (seat.students || []).find(
            (s) => s.studentId?.toString() === student._id.toString()
          );
          if (found) {
            studentSeat = {
              hallName:   hall.hallName,
              seatLabel:  seat.seatLabel,
              row:        seat.row,
              col:        seat.col,
              benchMates: (seat.students || [])
                .filter((s) => s.studentId?.toString() !== student._id.toString())
                .map((s) => s.name),
            };
            break;
          }
        }
        if (studentSeat) break;
      }

      res.json({ success: true, data: studentSeat });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

const SeatingArrangement = require('../models/SeatingArrangement');
module.exports = router;
