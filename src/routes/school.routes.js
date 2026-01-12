import express from 'express';
import { createSchool, getAllSchools, getSchoolById } from '../controllers/school.controller.js';

const router = express.Router();

// POST /api/schools - Create school (SUPER_ADMIN only - will add auth later)
router.post('/', createSchool);

// GET /api/schools - Get all schools (SUPER_ADMIN only - will add auth later)
router.get('/', getAllSchools);

// GET /api/schools/:id - Get school by ID
router.get('/:id', getSchoolById);

export default router;
