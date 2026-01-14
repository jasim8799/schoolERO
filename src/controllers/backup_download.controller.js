const { backupSchoolData, encryptData } = require('../utils/backup');
const { USER_ROLES } = require('../config/constants');
const { auditLog } = require('../utils/auditLog');

// Download backup for Principal (own school only)
const downloadBackupController = async (req, res) => {
  try {
    // Only Principal can download backups
    if (req.user.role !== USER_ROLES.PRINCIPAL) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Principal only.'
      });
    }

    const { schoolId } = req.user;

    // Generate backup data for the requesting school
    const backupData = await backupSchoolData(schoolId);

    // Encrypt the backup data
    const encryptedData = encryptData(backupData);

    // Create timestamped filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup_${schoolId}_${timestamp}.enc`;

    // Create backup file content
    const backupContent = {
      version: '1.0',
      schoolId,
      timestamp: new Date().toISOString(),
      ...encryptedData
    };

    // Log the download action
    await auditLog({
      action: 'BACKUP_DOWNLOADED',
      entityType: 'SYSTEM',
      entityId: schoolId,
      details: {
        filename,
        checksum: encryptedData.checksum,
        downloadTimestamp: new Date().toISOString()
      },
      performedBy: req.user._id,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent')
    });

    // Set response headers for file download
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Send the encrypted backup data
    res.json(backupContent);

  } catch (error) {
    console.error('Error in downloadBackupController:', error);

    // Log the failed attempt
    await auditLog({
      action: 'BACKUP_DOWNLOAD_FAILED',
      entityType: 'SYSTEM',
      entityId: req.user?.schoolId,
      details: {
        error: error.message,
        downloadTimestamp: new Date().toISOString()
      },
      performedBy: req.user?._id,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent')
    });

    res.status(500).json({
      success: false,
      message: 'Failed to generate backup',
      error: error.message
    });
  }
};

module.exports = {
  downloadBackupController
};
