const express = require('express');
const {
  getAutomations,
  createAutomation,
  updateAutomation,
  deleteAutomation,
  runAutomations
} = require('../controllers/automation.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireMinRole } = require('../middlewares/role.middleware');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

router.use(authenticate);

router.get('/', requireMinRole(USER_ROLES.OPERATOR), getAutomations);
router.post('/', requireMinRole(USER_ROLES.PRINCIPAL), createAutomation);
router.patch('/:id', requireMinRole(USER_ROLES.PRINCIPAL), updateAutomation);
router.delete('/:id', requireMinRole(USER_ROLES.PRINCIPAL), deleteAutomation);

// Manually trigger rules for a specific trigger type
router.post('/run', requireMinRole(USER_ROLES.PRINCIPAL), runAutomations);

module.exports = router;
