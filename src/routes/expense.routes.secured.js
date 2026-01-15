import express from 'express';
import { createExpense, getExpenses, getExpenseSummary, upload } from '../controllers/expense.controller.js';
import { authenticate } from '../middlewares/auth.middleware.fixed.js';
import { requireRole } from '../middlewares/role.middleware.js';
import { enforceSchoolIsolation, validateFileUpload } from '../middlewares/security.middleware.final.js';
import { checkStorageLimit } from '../middlewares/schoolLimits.middleware.js';

const router = express.Router();

// All routes require authentication and school validation
router.use(authenticate);
router.use(enforceSchoolIsolation);

// Only Principal and Operator can access expense management
router.use(requireRole('PRINCIPAL', 'OPERATOR'));

// Routes
router.post('/', validateFileUpload(), checkStorageLimit, createExpense);
router.get('/', getExpenses);
router.get('/summary', getExpenseSummary);

export default router;
