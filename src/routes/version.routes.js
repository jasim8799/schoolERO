const express = require('express');
const { getAppVersion } = require('../controllers/version.controller');

const router = express.Router();

// Get app version info - no authentication required
router.get('/', getAppVersion);

module.exports = router;
