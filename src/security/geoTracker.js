function extractGeoInfo(req) {
  const country = req.headers['x-country'] || req.headers['cf-ipcountry'] || 'Unknown';
  const region = req.headers['x-region'] || 'Unknown';
  const city = req.headers['x-city'] || 'Unknown';

  return {
    country,
    region,
    city,
    ipAddress: req.ip
  };
}

module.exports = { extractGeoInfo };
