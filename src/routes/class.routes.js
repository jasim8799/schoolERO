const express = require('express');
const {
  createClass,
  getAllClasses,
  getClassById,
  updateClass,
  deleteClass
} = require('../controllers/class.controller.js');
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

// PATCH /api/classes/:id - Update class (PRINCIPAL only)
router.patch(
  '/:id',
  authenticate,
  requireMinRole(USER_ROLES.PRINCIPAL),
  updateClass
);

// DELETE /api/classes/:id - Delete class (PRINCIPAL only)
router.delete(
  '/:id',
  authenticate,
  requireMinRole(USER_ROLES.PRINCIPAL),
  deleteClass
);

module.exports = router;
