const { getBackupStatus, backupSchoolData, saveBackup } = require('../utils/backup');
const { USER_ROLES, HTTP_STATUS } = require('../config/constants');

const getBackupStatusController = async (req, res) => {
  try {
    // Only Super Admin can view backup status
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'Access denied. Super Admin only.'
      });
    }

    const status = await getBackupStatus();

    if (status.error) {
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Error retrieving backup status',
        error: status.error
      });
    }

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: status
    });
  } catch (error) {
    console.error('Backup status error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error retrieving backup status',
      error: error.message
    });
  }
};

const triggerManualBackupController = async (req, res) => {
  try {
    // Only Principal can trigger manual backup
    if (req.user.role !== USER_ROLES.PRINCIPAL) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'Access denied. Principal only.'
      });
    }

    // Backup the principal's school data
    const backupData = await backupSchoolData(req.user.schoolId);

    // Save encrypted backup
    const { filepath } = await saveBackup(req.user.schoolId, backupData);

    // Download the backup file
    res.download(filepath, (err) => {
      if (err) {
        console.error('Download error:', err);
        // File might have been sent already, don't send error response
        return;
      }
      // Optionally clean up file after download, but keep for retention
    });
  } catch (error) {
    console.error('Manual backup error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error creating backup',
      error: error.message
    });
  }
};

module.exports = {
  getBackupStatusController,
  triggerManualBackupController
};
