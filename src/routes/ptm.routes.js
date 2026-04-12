const express = require('express');
const { authenticate } = require('../middlewares/auth.middleware');
const { enforceSchoolIsolation } = require('../middlewares/school.middleware');
const { requireRole } = require('../middlewares/role.middleware');
const {
  createPtm, getPtms, bookPtm,
  getMyBookings, getPtmBookings,
  updatePtmStatus, cancelBooking,
} = require('../controllers/ptm.controller');
const { USER_ROLES } = require('../config/constants');
const router = express.Router();

router.post('/',
  authenticate, enforceSchoolIsolation,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  createPtm);

router.get('/',
  authenticate, enforceSchoolIsolation,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR,
              USER_ROLES.TEACHER, USER_ROLES.STUDENT, USER_ROLES.PARENT),
  getPtms);

router.post('/book',
  authenticate, enforceSchoolIsolation,
  requireRole(USER_ROLES.STUDENT, USER_ROLES.PARENT),
  bookPtm);

router.get('/my',
  authenticate, enforceSchoolIsolation,
  requireRole(USER_ROLES.STUDENT, USER_ROLES.PARENT),
  getMyBookings);

router.get('/:ptmId/bookings',
  authenticate, enforceSchoolIsolation,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  getPtmBookings);

router.patch('/:id/status',
  authenticate, enforceSchoolIsolation,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  updatePtmStatus);

router.patch('/booking/:id/cancel',
  authenticate, enforceSchoolIsolation,
  requireRole(USER_ROLES.STUDENT, USER_ROLES.PARENT),
  cancelBooking);

module.exports = router;
