const mongoose = require('mongoose');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const cron = require('node-cron');
const { auditLog } = require('./auditLog');

// Critical collections to backup (school-wise isolated)
const CRITICAL_COLLECTIONS = [
  'schools',
  'users',
  'students',
  'parents',
  'teachers',
  'subjects',
  'classes',
  'sections',
  'academicsessions',
  'studentdailyattendances',
  'studentsubjectattendances',
  'teacherattendances',
  'exams',
  'examforms',
  'exampayments',
  'admitcards',
  'results',
  'feestructures',
  'studentfees',
  'feepayments',
  'onlinepayments',
  'expenses',
  'salaryprofiles',
  'salarycalculations',
  'salarypayments',
  'vehicles',
  'routes',
  'studenttransports',
  'hostels',
  'rooms',
  'studenthostels',
  'hostelleaves',
  'homeworks',
  'academic histories',
  'promotions',
  'tcs',
  'notices',
  'auditlogs'
];

// Backup configuration
const BACKUP_CONFIG = {
  RETENTION_DAYS: 30,
  ENCRYPTION_ALGORITHM: 'aes-256-gcm',
  BACKUP_DIR: path.join(__dirname, '../../backups'),
  SCHEDULE: '0 2 * * *', // Daily at 2 AM
};

// Generate encryption key from environment variable
const getEncryptionKey = () => {
  const key = process.env.BACKUP_ENCRYPTION_KEY;
  if (!key || key.length !== 32) {
    throw new Error('BACKUP_ENCRYPTION_KEY must be set to a 32-character string');
  }
  return key;
};

// Create backup directory if it doesn't exist
const ensureBackupDir = async () => {
  try {
    await fs.access(BACKUP_CONFIG.BACKUP_DIR);
  } catch {
    await fs.mkdir(BACKUP_CONFIG.BACKUP_DIR, { recursive: true });
  }
};

// Generate checksum for integrity verification
const generateChecksum = (data) => {
  return crypto.createHash('sha256').update(data).digest('hex');
};

// Encrypt data using AES-256-GCM
const encryptData = (data) => {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipher(BACKUP_CONFIG.ENCRYPTION_ALGORITHM, key);
  cipher.setAAD(Buffer.from('school-erp-backup'));

  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    checksum: generateChecksum(JSON.stringify(data))
  };
};

// Decrypt data using AES-256-GCM
const decryptData = (encryptedData, iv, authTag) => {
  const key = getEncryptionKey();
  const decipher = crypto.createDecipher(BACKUP_CONFIG.ENCRYPTION_ALGORITHM, key);
  decipher.setAAD(Buffer.from('school-erp-backup'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));

  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return JSON.parse(decrypted);
};

// Backup a single school's data
const backupSchoolData = async (schoolId) => {
  const backupData = {
    schoolId,
    timestamp: new Date().toISOString(),
    collections: {}
  };

  for (const collectionName of CRITICAL_COLLECTIONS) {
    try {
      const Model = mongoose.model(collectionName.charAt(0).toUpperCase() + collectionName.slice(1));
      const data = await Model.find({ schoolId }).lean();
      backupData.collections[collectionName] = data;
    } catch (error) {
      // Collection might not exist or have different name
      console.warn(`Warning: Could not backup collection ${collectionName}:`, error.message);
      backupData.collections[collectionName] = [];
    }
  }

  return backupData;
};

// Save encrypted backup to file and database
const saveBackup = async (schoolId, backupData) => {
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const filename = `backup_${schoolId}_${date}.enc`;
  const filepath = path.join(BACKUP_CONFIG.BACKUP_DIR, filename);

  const encryptedData = encryptData(backupData);

  const backupFile = {
    version: '1.0',
    schoolId,
    date,
    ...encryptedData
  };

  await fs.writeFile(filepath, JSON.stringify(backupFile, null, 2));

  // Get file size
  const stats = await fs.stat(filepath);

  // Save to database
  const Backup = mongoose.model('Backup');
  const backupRecord = new Backup({
    schoolId,
    status: 'COMPLETED',
    size: stats.size,
    filepath,
    checksum: encryptedData.checksum,
    type: 'FULL'
  });

  await backupRecord.save();

  return { filepath, checksum: encryptedData.checksum, backupId: backupRecord._id };
};

// Clean up old backups (retain only last 30 days)
const cleanupOldBackups = async () => {
  try {
    const files = await fs.readdir(BACKUP_CONFIG.BACKUP_DIR);
    const backupFiles = files.filter(file => file.startsWith('backup_') && file.endsWith('.enc'));

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - BACKUP_CONFIG.RETENTION_DAYS);

    for (const file of backupFiles) {
      const filePath = path.join(BACKUP_CONFIG.BACKUP_DIR, file);
      const stats = await fs.stat(filePath);

      if (stats.mtime < cutoffDate) {
        await fs.unlink(filePath);
        console.log(`Cleaned up old backup: ${file}`);
      }
    }
  } catch (error) {
    console.error('Error during backup cleanup:', error);
  }
};

// Perform full backup for all schools
const performFullBackup = async () => {
  console.log('Starting automated backup process...');

  try {
    await ensureBackupDir();

    // Get all schools
    const School = mongoose.model('School');
    const schools = await School.find({}, '_id name').lean();

    const results = [];

    for (const school of schools) {
      try {
        console.log(`Backing up school: ${school.name} (${school._id})`);

        // Backup school data
        const backupData = await backupSchoolData(school._id);

        // Save encrypted backup
        const { filepath, checksum } = await saveBackup(school._id, backupData);

        results.push({
          schoolId: school._id,
          schoolName: school.name,
          filepath,
          checksum,
          status: 'success'
        });

        console.log(`Backup completed for ${school.name}`);

      } catch (error) {
        console.error(`Backup failed for school ${school.name}:`, error);
        results.push({
          schoolId: school._id,
          schoolName: school.name,
          error: error.message,
          status: 'failed'
        });
      }
    }

    // Cleanup old backups
    await cleanupOldBackups();

    // Log results to audit
    const successCount = results.filter(r => r.status === 'success').length;
    const failureCount = results.filter(r => r.status === 'failed').length;

    await auditLog({
      action: 'BACKUP_COMPLETED',
      entityType: 'SYSTEM',
      entityId: null,
      details: {
        totalSchools: schools.length,
        successfulBackups: successCount,
        failedBackups: failureCount,
        results
      },
      ipAddress: 'SYSTEM',
      userAgent: 'AUTOMATED_BACKUP'
    });

    console.log(`Backup process completed. Success: ${successCount}, Failed: ${failureCount}`);

    return { success: true, results };

  } catch (error) {
    console.error('Backup process failed:', error);

    await auditLog({
      action: 'BACKUP_FAILED',
      entityType: 'SYSTEM',
      entityId: null,
      details: { error: error.message },
      ipAddress: 'SYSTEM',
      userAgent: 'AUTOMATED_BACKUP'
    });

    return { success: false, error: error.message };
  }
};

// Get backup status for Super Admin
const getBackupStatus = async () => {
  try {
    const files = await fs.readdir(BACKUP_CONFIG.BACKUP_DIR);
    const backupFiles = files.filter(file => file.startsWith('backup_') && file.endsWith('.enc'));

    const backups = [];

    for (const file of backupFiles) {
      const filePath = path.join(BACKUP_CONFIG.BACKUP_DIR, file);
      const stats = await fs.stat(filePath);

      // Parse filename: backup_SCHOOLID_DATE.enc
      const parts = file.replace('backup_', '').replace('.enc', '').split('_');
      const schoolId = parts[0];
      const date = parts[1];

      backups.push({
        schoolId,
        date,
        filename: file,
        size: stats.size,
        createdAt: stats.mtime
      });
    }

    // Sort by date descending
    backups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return {
      totalBackups: backups.length,
      retentionDays: BACKUP_CONFIG.RETENTION_DAYS,
      lastBackup: backups.length > 0 ? backups[0] : null,
      backups: backups.slice(0, 10) // Return last 10 backups
    };

  } catch (error) {
    console.error('Error getting backup status:', error);
    return { error: error.message };
  }
};

// Initialize backup scheduler
const initializeBackupScheduler = () => {
  console.log('Initializing backup scheduler...');

  // Schedule daily backup at 2 AM
  cron.schedule(BACKUP_CONFIG.SCHEDULE, async () => {
    console.log('Running scheduled backup...');
    await performFullBackup();
  });

  console.log(`Backup scheduler initialized. Next run at ${BACKUP_CONFIG.SCHEDULE}`);
};

// Manual backup trigger (for testing/admin purposes)
const triggerManualBackup = async () => {
  console.log('Manual backup triggered...');
  return await performFullBackup();
};

module.exports = {
  performFullBackup,
  getBackupStatus,
  initializeBackupScheduler,
  triggerManualBackup,
  CRITICAL_COLLECTIONS,
  BACKUP_CONFIG
};
