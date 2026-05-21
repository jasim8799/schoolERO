const fs = require('fs');
const path = require('path');

async function s3Upload({ buffer, key }) {
  const localPath = path.join(process.cwd(), 'uploads', key);
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, buffer);
  return { url: `/${path.join('uploads', key).replace(/\\/g, '/')}`, key };
}

module.exports = { s3Upload };
