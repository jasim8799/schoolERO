const express = require('express');
const {
  getJobs,
  getJobById,
  runJob,
  flushQueue,
} = require('../controllers/jobs.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/role.middleware');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();
router.use(authenticate);
router.use(requireRole(USER_ROLES.SUPER_ADMIN));

// GET /api/jobs — full dashboard: jobs + workers + health + AI
// Params: status, search
router.get('/', getJobs);

// POST /api/jobs/run — trigger a job manually
router.post('/run', runJob);

// POST /api/jobs/flush — flush a queue
router.post('/flush', flushQueue);

// GET /api/jobs/:id — single job detail
router.get('/:id', getJobById);

module.exports = router;
