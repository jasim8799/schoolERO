const express = require('express');
const { createExpense, getExpenses, getExpenseSummary, upload } = require('../controllers/expense.controller');
const { authenticate } = require('../middlewares/auth.middleware.fixed');
const { authorizeRoles } = require('../middlewares/role.middleware');
const { enforceSchoolIsolation, validateFileUpload } = require('../middlewares/security.middleware.final');
const { checkStorageLimit } = require('../middlewares/schoolLimits.middleware');

const router = express.Router();

// All routes require authentication and school validation
router.use(authenticate);
router.use(enforceSchoolIsolation);

// Only Principal and Operator can access expense management
router.use(authorizeRoles('PRINCIPAL', 'OPERATOR'));

// Routes
router.post('/', validateFileUpload(), checkStorageLimit, createExpense);
router.get('/', getExpenses);
router.get('/summary', getExpenseSummary);

module.exports = router;
