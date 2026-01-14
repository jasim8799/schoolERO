const express = require('express');
const { createExpense, getExpenses, getExpenseSummary, upload } = require('../controllers/expense.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { authorizeRoles } = require('../middlewares/role.middleware');
const { validateSchool } = require('../middlewares/school.middleware');

const router = express.Router();

// All routes require authentication and school validation
router.use(authenticate);
router.use(validateSchool);

// Only Principal and Operator can access expense management
router.use(authorizeRoles('PRINCIPAL', 'OPERATOR'));

// Routes
router.post('/', upload.single('billAttachment'), createExpense);
router.get('/', getExpenses);
router.get('/summary', getExpenseSummary);

module.exports = router;
