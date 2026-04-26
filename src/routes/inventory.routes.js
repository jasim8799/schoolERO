const express = require('express');
const { exportInventoryController } = require('../controllers/inventory.controller');

const router = express.Router();

// Authentication is already handled by app-level middleware in app.js.
router.get('/export', exportInventoryController);

module.exports = router;
