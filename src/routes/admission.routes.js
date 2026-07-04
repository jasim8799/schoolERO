const express = require('express');
const router  = express.Router();

const { authenticate }  = require('../middlewares/auth.middleware');
const { requireRole }   = require('../middlewares/role.middleware');
const { USER_ROLES }    = require('../config/constants');
const admissionCtrl     = require('../controllers/admission.controller');
const {
  captureAdmissionCreate,
  captureAdmissionUpdate,
  captureAdmissionDelete,
} = require('../middlewares/activityCapture.middleware');
const { uploadDocuments } = require('../controllers/upload.controller');
const fileUpload = require('express-fileupload');

// List all admissions for school
router.get(
  '/',
  authenticate,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  admissionCtrl.getAllAdmissions
);

// Create admission record  — PRINCIPAL or OPERATOR only
router.post(
  '/',
  authenticate,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  captureAdmissionCreate,
  admissionCtrl.createAdmission
);

// Get admission record for a student — PRINCIPAL, OPERATOR, or TEACHER
router.get(
  '/student/:studentId',
  authenticate,
  admissionCtrl.getAdmissionByStudent
);

// Get student photo for profile avatar
router.get(
  '/student/:studentId/photo',
  authenticate,
  admissionCtrl.getStudentPhoto
);

// Get single document dataUrl
router.get(
  '/:id/documents/:docType/data',
  authenticate,
  admissionCtrl.getDocumentData
);

// Update admission
router.patch(
  '/:id',
  authenticate,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  captureAdmissionUpdate,
  admissionCtrl.updateAdmission
);

// Upload admission documents
router.post(
  '/:id/documents',
  authenticate,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  fileUpload({ limits: { fileSize: 5 * 1024 * 1024 } }),
  uploadDocuments
);

// Cancel admission
router.delete(
  '/:id',
  authenticate,
  requireRole(USER_ROLES.PRINCIPAL),
  captureAdmissionDelete,
  admissionCtrl.deleteAdmission
);

module.exports = router;
