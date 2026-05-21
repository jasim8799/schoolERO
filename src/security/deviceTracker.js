const crypto = require('crypto');

function getDeviceHash(ipAddress = '', userAgent = '') {
  return crypto.createHash('sha256').update(`${ipAddress}|${userAgent}`).digest('hex');
}

module.exports = { getDeviceHash };
