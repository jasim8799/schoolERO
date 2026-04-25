const express = require('express');
const {
  getAutomations,
  createAutomation,
  updateAutomation,
  deleteAutomation,
  runAutomations,
  getActiveNotifications,
  getMyNotifications,
} = require('../controllers/automation.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireMinRole } = require('../middlewares/role.middleware');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

router.use(authenticate);

// Static routes - must be before /:id routes
router.get('/my-notifications', getMyNotifications);
router.get('/active-notifications', requireMinRole(USER_ROLES.OPERATOR), getActiveNotifications);
router.post('/run', requireMinRole(USER_ROLES.PRINCIPAL), runAutomations);

// Collection routes
router.get('/', requireMinRole(USER_ROLES.OPERATOR), getAutomations);
router.post('/', requireMinRole(USER_ROLES.PRINCIPAL), createAutomation);

// Dynamic id routes - must be last
router.patch('/:id', requireMinRole(USER_ROLES.PRINCIPAL), updateAutomation);
router.delete('/:id', requireMinRole(USER_ROLES.PRINCIPAL), deleteAutomation);

module.exports = router;
