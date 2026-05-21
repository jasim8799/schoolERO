function generateCSV(data) {
  if (!Array.isArray(data) || data.length === 0) {
    return Buffer.from('');
  }

  const headers = Object.keys(data[0]);
  const rows = data.map((row) =>
    headers
      .map((h) => `\"${String(row[h] ?? '').replace(/\"/g, '\"\"')}\"`)
      .join(',')
  );

  return Buffer.from([headers.join(','), ...rows].join('\n'));
}

module.exports = { generateCSV };
