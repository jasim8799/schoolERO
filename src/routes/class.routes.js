const express = require('express');
const { createClass, getAllClasses, getClassById } = require('../controllers/class.controller.js');
const { authenticate } = require('../middlewares/auth.middleware.js');
const { requireMinRole } = require('../middlewares/role.middleware.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

// POST /api/classes - Create class
router.post(
  '/',
  authenticate,
  requireMinRole(USER_ROLES.OPERATOR),
  createClass
);

// GET /api/classes - Get all classes
router.get(
  '/',
  authenticate,
  requireMinRole(USER_ROLES.TEACHER),
  getAllClasses
);

// GET /api/classes/:id - Get class by ID
router.get(
  '/:id',
  authenticate,
  requireMinRole(USER_ROLES.TEACHER),
  getClassById
);

module.exports = router;
