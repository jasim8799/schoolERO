const ExcelJS = require('exceljs');

async function generateExcel(reportData, category) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Schoolero ERP';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(String(category || 'Report').substring(0, 31));

  worksheet.addRow([category, '', '', `Generated: ${new Date().toISOString()}`]);
  worksheet.getRow(1).font = { bold: true, color: { argb: 'FF00E5FF' } };
  worksheet.addRow([]);

  if (reportData.summary) {
    worksheet.addRow(['Summary']);
    Object.entries(reportData.summary).forEach(([k, v]) => {
      worksheet.addRow([k, String(v)]);
    });
    worksheet.addRow([]);
  }

  if (Array.isArray(reportData.data) && reportData.data.length > 0) {
    const headers = Object.keys(reportData.data[0]);
    const headerRow = worksheet.addRow(headers);
    headerRow.font = { bold: true };

    reportData.data.forEach((row) => {
      worksheet.addRow(headers.map((h) => row[h]));
    });

    worksheet.columns.forEach((column) => {
      let maxLen = 10;
      column.eachCell({ includeEmpty: true }, (cell) => {
        const len = cell.value ? String(cell.value).length : 0;
        if (len > maxLen) maxLen = len;
      });
      column.width = Math.min(maxLen + 2, 50);
    });
  }

  return workbook.xlsx.writeBuffer();
}

module.exports = { generateExcel };
