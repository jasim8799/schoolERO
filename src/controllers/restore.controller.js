const mongoose = require('mongoose');
const { decryptData } = require('../utils/backup');
const { USER_ROLES } = require('../config/constants');
const { auditLog } = require('../utils/auditLog');
const School = require('../models/School');

// Preview restore - validate backup and return info
const previewRestoreController = async (req, res) => {
  try {
    // Only Super Admin can preview restores
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Super Admin only.'
      });
    }

    const { backupData } = req.body;

    if (!backupData) {
      return res.status(400).json({
        success: false,
        message: 'Backup data is required'
      });
    }

    // Validate backup data structure
    if (!backupData.version || !backupData.schoolId || !backupData.encrypted || !backupData.iv || !backupData.authTag) {
      return res.status(400).json({
        success: false,
        message: 'Invalid backup file format'
      });
    }

    // Decrypt backup data
    let decryptedData;
    try {
      decryptedData = decryptData(backupData.encrypted, backupData.iv, backupData.authTag);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'Failed to decrypt backup file. Invalid or corrupted backup.'
      });
    }

    // Validate backup integrity
    if (!decryptedData.schoolId || !decryptedData.timestamp || !decryptedData.collections) {
      return res.status(400).json({
        success: false,
        message: 'Invalid backup content. Missing required fields.'
      });
    }

    // Get school information
    const school = await School.findById(decryptedData.schoolId).select('name').lean();
    if (!school) {
      return res.status(400).json({
        success: false,
        message: 'School not found in system'
      });
    }

    // Calculate record counts
    const collectionStats = {};
    let totalRecords = 0;

    for (const [collectionName, records] of Object.entries(decryptedData.collections)) {
      const count = Array.isArray(records) ? records.length : 0;
      collectionStats[collectionName] = count;
      totalRecords += count;
    }

    // Log preview action
    await auditLog({
      action: 'RESTORE_PREVIEW',
      entityType: 'SYSTEM',
      entityId: decryptedData.schoolId,
      details: {
        schoolId: decryptedData.schoolId,
        backupTimestamp: decryptedData.timestamp,
        totalRecords,
        collectionsCount: Object.keys(collectionStats).length
      },
      performedBy: req.user._id,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      data: {
        schoolId: decryptedData.schoolId,
        schoolName: school.name,
        backupDate: decryptedData.timestamp,
        totalRecords,
        collections: collectionStats,
        collectionsCount: Object.keys(collectionStats).length
      }
    });

  } catch (error) {
    console.error('Error in previewRestoreController:', error);

    await auditLog({
      action: 'RESTORE_PREVIEW_FAILED',
      entityType: 'SYSTEM',
      entityId: null,
      details: { error: error.message },
      performedBy: req.user?._id,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent')
    });

    res.status(500).json({
      success: false,
      message: 'Failed to preview restore',
      error: error.message
    });
  }
};

// Execute restore - archive current data and restore backup
const executeRestoreController = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Only Super Admin can execute restores
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Super Admin only.'
      });
    }

    const { backupData, confirmRestore } = req.body;

    if (!backupData || !confirmRestore) {
      return res.status(400).json({
        success: false,
        message: 'Backup data and explicit confirmation required'
      });
    }

    if (confirmRestore !== true) {
      return res.status(400).json({
        success: false,
        message: 'Explicit confirmation required (confirmRestore must be true)'
      });
    }

    // Validate backup data structure
    if (!backupData.version || !backupData.schoolId || !backupData.encrypted || !backupData.iv || !backupData.authTag) {
      return res.status(400).json({
        success: false,
        message: 'Invalid backup file format'
      });
    }

    // Decrypt backup data
    let decryptedData;
    try {
      decryptedData = decryptData(backupData.encrypted, backupData.iv, backupData.authTag);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'Failed to decrypt backup file. Invalid or corrupted backup.'
      });
    }

    const { schoolId } = decryptedData;

    // Verify school exists
    const school = await School.findById(schoolId).select('name').lean();
    if (!school) {
      return res.status(400).json({
        success: false,
        message: 'School not found in system'
      });
    }

    // Generate restore version tag
    const restoreVersion = `RESTORE_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Archive current data for each collection
    const archiveResults = {};
    const restoreResults = {};

    for (const [collectionName, backupRecords] of Object.entries(decryptedData.collections)) {
      try {
        // Get the model for this collection
        const Model = mongoose.model(collectionName.charAt(0).toUpperCase() + collectionName.slice(1));

        // Archive current records by adding restore version tag
        const currentRecords = await Model.find({ schoolId }).lean();
        if (currentRecords.length > 0) {
          // Add archive tag to current records
          await Model.updateMany(
            { schoolId },
            {
              $set: {
                archivedAt: new Date(),
                archivedBy: req.user._id,
                restoreVersion: restoreVersion,
                isArchived: true
              }
            },
            { session }
          );
          archiveResults[collectionName] = currentRecords.length;
        } else {
          archiveResults[collectionName] = 0;
        }

        // Clear current records (they are now archived)
        await Model.deleteMany({ schoolId }, { session });

        // Restore backup records
        if (Array.isArray(backupRecords) && backupRecords.length > 0) {
          // Add restore metadata to backup records
          const recordsToRestore = backupRecords.map(record => ({
            ...record,
            restoredAt: new Date(),
            restoredBy: req.user._id,
            restoreVersion: restoreVersion,
            _id: record._id // Preserve original IDs
          }));

          await Model.insertMany(recordsToRestore, { session });
          restoreResults[collectionName] = backupRecords.length;
        } else {
          restoreResults[collectionName] = 0;
        }

      } catch (error) {
        console.error(`Error processing collection ${collectionName}:`, error);
        // Continue with other collections but log the error
        archiveResults[collectionName] = 'ERROR';
        restoreResults[collectionName] = 'ERROR';
      }
    }

    // Commit transaction
    await session.commitTransaction();

    // Log successful restore
    await auditLog({
      action: 'RESTORE_EXECUTED',
      entityType: 'SYSTEM',
      entityId: schoolId,
      details: {
        schoolId,
        schoolName: school.name,
        backupTimestamp: decryptedData.timestamp,
        restoreVersion,
        archivedCollections: archiveResults,
        restoredCollections: restoreResults,
        totalArchived: Object.values(archiveResults).filter(v => typeof v === 'number').reduce((a, b) => a + b, 0),
        totalRestored: Object.values(restoreResults).filter(v => typeof v === 'number').reduce((a, b) => a + b, 0)
      },
      performedBy: req.user._id,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'Restore completed successfully',
      data: {
        schoolId,
        schoolName: school.name,
        restoreVersion,
        backupDate: decryptedData.timestamp,
        archivedCollections: archiveResults,
        restoredCollections: restoreResults
      }
    });

  } catch (error) {
    // Abort transaction on error
    await session.abortTransaction();

    console.error('Error in executeRestoreController:', error);

    await auditLog({
      action: 'RESTORE_EXECUTION_FAILED',
      entityType: 'SYSTEM',
      entityId: req.body?.backupData?.schoolId,
      details: { error: error.message },
      performedBy: req.user?._id,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent')
    });

    res.status(500).json({
      success: false,
      message: 'Restore failed',
      error: error.message
    });
  } finally {
    session.endSession();
  }
};

module.exports = {
  previewRestoreController,
  executeRestoreController
};
