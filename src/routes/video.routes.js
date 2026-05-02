const express = require('express');
const { authenticate } = require('../middlewares/auth.middleware.js');
const { enforceSchoolIsolation } = require('../middlewares/school.middleware.js');
const { requireMinRole } = require('../middlewares/role.middleware.js');
const { createVideo, getVideos, deleteVideo, updateVideo } = require('../controllers/video.controller.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

// All routes require authentication and school isolation
router.use(authenticate);
router.use(enforceSchoolIsolation);

// GET /api/videos - Parents and above can view videos
router.get('/', requireMinRole(USER_ROLES.PARENT), getVideos);

// POST /api/videos - Teachers, Operators, Principal can upload
router.post('/', requireMinRole(USER_ROLES.TEACHER), createVideo);

// PATCH /api/videos/:id - Teachers, Operators, Principal can update
router.patch('/:id', requireMinRole(USER_ROLES.TEACHER), updateVideo);

// DELETE /api/videos/:id - Principal and above can delete
router.delete('/:id', requireMinRole(USER_ROLES.PRINCIPAL), deleteVideo);

module.exports = router;
