const mongoose = require('mongoose');
const { auditLog } = require('../utils/auditLog');
const { getBackupStatus, triggerManualBackup, backupSchoolData, encryptData } = require('../utils/backup');
const { USER_ROLES } = require('../config/constants');

// Get backup status (Super Admin only)
const getBackupStatusController = async (req, res) => {
  try {
    // Only Super Admin can view backup status
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Super Admin only.'
      });
    }

    const status = await getBackupStatus();

    if (status.error) {
      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve backup status',
        error: status.error
      });
    }

    res.json({
      success: true,
      data: status
    });

  } catch (error) {
    console.error('Error in getBackupStatusController:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Trigger manual backup (Principal only)
const triggerManualBackupController = async (req, res) => {
  try {
    // Only Principal can trigger manual backups
    if (req.user.role !== USER_ROLES.PRINCIPAL) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Principal only.'
      });
    }

    const schoolId = req.user.schoolId;

    // Generate backup data for the requesting school
    const backupData = await backupSchoolData(schoolId);

    // Encrypt the backup data
    const encryptedData = encryptData(backupData);

    const timestamp = Date.now();
    const filename = `backup_${schoolId}_${timestamp}.enc`;

    // Create backup file content
    const backupContent = {
      version: '1.0',
      schoolId,
      encrypted: encryptedData.encrypted,
      iv: encryptedData.iv,
      authTag: encryptedData.authTag,
      checksum: encryptedData.checksum,
      timestamp: new Date().toISOString(),
      filename
    };

    // Track downloaded backup in database
    const Backup = mongoose.model('Backup');
    await Backup.create({
      schoolId,
      status: 'COMPLETED',
      size: Buffer.byteLength(encryptedData.encrypted, 'hex'),
      filepath: 'DOWNLOAD_ONLY',
      checksum: encryptedData.checksum,
      type: 'FULL'
    });

    // Audit log the download
    await auditLog({
      action: 'BACKUP_DOWNLOADED',
      userId: req.user._id,
      role: req.user.role,
      entityType: 'SYSTEM',
      entityId: schoolId,
      description: 'Encrypted school backup downloaded',
      schoolId,
      details: {
        filename,
        checksum: encryptedData.checksum
      },
      req
    });

    // Send as file download
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(JSON.stringify(backupContent), 'utf8'));

  } catch (error) {
    console.error('Error in triggerManualBackupController:', error);

    // Audit log the failed download
    await auditLog({
      action: 'BACKUP_DOWNLOAD_FAILED',
      userId: req.user._id,
      role: req.user.role,
      entityType: 'SYSTEM',
      entityId: req.user.schoolId,
      description: 'Backup download failed',
      schoolId: req.user.schoolId,
      details: { error: error.message },
      req
    });

    res.status(500).json({
      success: false,
      message: 'Failed to generate backup',
      error: error.message
    });
  }
};

module.exports = {
  getBackupStatusController,
  triggerManualBackupController
};
