const express = require('express');
const { getEvents } = require('../controllers/event.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireMinRole } = require('../middlewares/role.middleware');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

router.use(authenticate);

// GET paginated event log
router.get('/', requireMinRole(USER_ROLES.OPERATOR), getEvents);

module.exports = router;
