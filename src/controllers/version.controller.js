// Version controller for app update checks
const getAppVersion = async (req, res) => {
  try {
    // For now, hardcode the minimum required version
    // In production, this could be stored in database or config
    const minimumVersion = {
      android: '1.0.0',
      ios: '1.0.0',
      web: '1.0.0'
    };

    res.json({
      minimumVersion,
      currentVersion: '1.0.0', // Current backend version
      forceUpdate: false, // Set to true to force update
      updateMessage: 'A new version is available. Please update to continue using the app.'
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getAppVersion
};
