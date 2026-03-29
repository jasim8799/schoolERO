const express = require('express');
const {
  getWorkflow,
  startWorkflow,
  advanceWorkflow,
  cancelWorkflow
} = require('../controllers/workflow.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireMinRole } = require('../middlewares/role.middleware');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

router.use(authenticate);

// GET the latest workflow for an entity + type
router.get('/:entityId/:type', requireMinRole(USER_ROLES.OPERATOR), getWorkflow);

// Start a new workflow
router.post('/start', requireMinRole(USER_ROLES.OPERATOR), startWorkflow);

// Advance the current step
router.post('/advance', requireMinRole(USER_ROLES.OPERATOR), advanceWorkflow);

// Cancel a workflow
router.post('/:workflowId/cancel', requireMinRole(USER_ROLES.OPERATOR), cancelWorkflow);

module.exports = router;
