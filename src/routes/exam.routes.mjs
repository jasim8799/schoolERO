import express from 'express';
import { createExam, getExams } from '../controllers/exam.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';

const router = express.Router();

// POST /api/exams - Principal, Operator
router.post(
  '/',
  authenticate,
  (req, res, next) => {
    if (!['PRINCIPAL', 'OPERATOR'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    next();
  },
  createExam
);

// GET /api/exams?classId= - Principal, Operator, Teacher
router.get(
  '/',
  authenticate,
  (req, res, next) => {
    if (!['PRINCIPAL', 'OPERATOR', 'TEACHER'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    next();
  },
  getExams
);

export default router;
