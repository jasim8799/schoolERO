const express = require('express');
const { exportInventoryController } = require('../controllers/inventory.controller');
const { authenticate } = require('../middlewares/auth.middleware');

const router = express.Router();

// All inventory routes require authentication
router.use(authenticate);

// Export inventory as Excel (Principal only)
router.get('/export', exportInventoryController);

module.exports = router;
