const express = require('express');
const { globalSearch } = require('../controllers/search.controller');
const { requireRole } = require('../middlewares/role.middleware');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

router.use(requireRole(USER_ROLES.SUPER_ADMIN));
router.get('/', globalSearch);

module.exports = router;
