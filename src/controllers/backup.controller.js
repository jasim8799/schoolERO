const { getBackupStatus, triggerManualBackup } = require('../utils/backup');
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
    const { backupSchoolData, encryptData } = require('../utils/backup');
    const backupData = await backupSchoolData(schoolId);

    // Encrypt the backup data
    const encryptedData = encryptData(backupData);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
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

    // Send the encrypted backup data
    res.json(backupContent);

  } catch (error) {
    console.error('Error in triggerManualBackupController:', error);
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
