const express = require('express');
const { createExpense, getExpenses, getExpenseSummary, upload } = require('../controllers/expense.controller.js');
const { authenticate } = require('../middlewares/auth.middleware.js');
const { requireRole } = require('../middlewares/role.middleware.js');
const { checkSchoolStatus } = require('../middlewares/school.middleware.js');

const router = express.Router();

// All routes require authentication and school validation
router.use(authenticate);
router.use(checkSchoolStatus);

// Only Principal and Operator can access expense management
router.use(requireRole('PRINCIPAL', 'OPERATOR'));

// Routes
router.post('/', upload.single('billAttachment'), createExpense);
router.get('/', getExpenses);
router.get('/summary', getExpenseSummary);

module.exports = router;
