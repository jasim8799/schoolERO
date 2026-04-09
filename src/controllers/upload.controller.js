const { HTTP_STATUS, USER_ROLES } = require('../config/constants');
const Admission = require('../models/Admission');

/**
 * POST /api/admissions/:id/documents
 * Accepts multipart form data with field names: aadhaar, birthCertificate, photo, tc
 * Stores base64-encoded file content in the Admission document
 */
const uploadDocuments = async (req, res) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.schoolId._id || req.user.schoolId;
    const { role } = req.user;

    if (role !== USER_ROLES.PRINCIPAL && role !== USER_ROLES.OPERATOR) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'Access denied. Only Principal or Operator can upload documents.',
      });
    }

    const admission = await Admission.findOne({ _id: id, schoolId });
    if (!admission) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Admission record not found',
      });
    }

    if (!req.files || Object.keys(req.files).length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'No files uploaded',
      });
    }

    const allowedFields = ['aadhaar', 'birthCertificate', 'photo', 'tc'];
    const updates = {};

    for (const fieldName of allowedFields) {
      const file = req.files[fieldName];
      if (!file) continue;

      const fileName = file.name || file.originalname || fieldName;
      const mimeType = file.mimetype || 'application/octet-stream';
      const data = file.data;
      const base64 = `data:${mimeType};base64,${data.toString('base64')}`;

      updates[`documents.${fieldName}.fileName`] = fileName;
      updates[`documents.${fieldName}.uploadedAt`] = new Date();
      updates[`documents.${fieldName}.dataUrl`] = base64;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'No supported file fields found in upload',
      });
    }

    await Admission.findByIdAndUpdate(id, { $set: updates });
    const updated = await Admission.findById(id).select('documents');

    return res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Documents uploaded successfully',
      data: updated?.documents || {},
    });
  } catch (error) {
    console.error('Upload documents error:', error);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to upload documents',
      error: error.message,
    });
  }
};

module.exports = { uploadDocuments };
