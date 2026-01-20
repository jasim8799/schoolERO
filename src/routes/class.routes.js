const express = require('express');
const { createClass, getAllClasses, getClassById } = require('../controllers/class.controller.js');
const { requireMinRole } = require('../middlewares/role.middleware.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

// POST /api/classes - Create class
router.post(
  '/',
  requireMinRole(USER_ROLES.OPERATOR),
  createClass
);

// GET /api/classes - Get all classes
router.get(
  '/',
  requireMinRole(USER_ROLES.OPERATOR),
  getAllClasses
);

// GET /api/classes/:id - Get class by ID
router.get(
  '/:id',
  requireMinRole(USER_ROLES.OPERATOR),
  getClassById
);

module.exports = router;
