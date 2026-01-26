const ExcelJS = require('exceljs');
const Inventory = require('../models/Inventory.js');
const { HTTP_STATUS, USER_ROLES } = require('../config/constants.js');
const { logger } = require('../utils/logger.js');
const { auditLog } = require('../utils/auditLog.js');

// Export inventory as Excel (Principal only)
const exportInventoryController = async (req, res) => {
  try {
    // Verify user is PRINCIPAL (additional check beyond middleware)
    if (req.user.role !== USER_ROLES.PRINCIPAL) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'Access denied. Only principals can export inventory.'
      });
    }

    // Fetch inventory data for the user's school
    const inventoryData = await Inventory.find({ schoolId: req.user.schoolId }).lean();

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('School Inventory');

    // Define columns with date formatting
    worksheet.columns = [
      { header: 'Item Code', key: 'code', width: 15 },
      { header: 'Item Name', key: 'name', width: 25 },
      { header: 'Category', key: 'category', width: 15 },
      { header: 'Quantity', key: 'quantity', width: 10 },
      { header: 'Assigned To', key: 'assignedTo', width: 15 },
      { header: 'Condition', key: 'condition', width: 12 },
      { header: 'Purchase Date', key: 'purchaseDate', width: 15, style: { numFmt: 'dd-mm-yyyy' } },
      { header: 'Cost', key: 'cost', width: 12 },
      { header: 'Remarks', key: 'remarks', width: 30 }
    ];

    // Style header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE6E6FA' }
    };

    // Freeze header row
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];

    // Add auto-filter
    worksheet.autoFilter = {
      from: 'A1',
      to: 'I1'
    };

    // Excel improvements: align numbers and format currency
    worksheet.getColumn('quantity').alignment = { horizontal: 'center' };
    worksheet.getColumn('cost').numFmt = '₹#,##0.00';

    // Add data rows with proper date formatting
    inventoryData.forEach(item => {
      worksheet.addRow({
        code: item.code,
        name: item.name,
        category: item.category,
        quantity: item.quantity,
        assignedTo: item.assignedTo,
        condition: item.condition,
        purchaseDate: item.purchaseDate,
        cost: item.cost,
        remarks: item.remarks
      });
    });

    // Generate filename
    const filename = `inventory_${req.user.schoolId}.xlsx`;

    // Create audit log BEFORE sending response
    await auditLog(req, {
      action: 'INVENTORY_EXPORTED',
      entityType: 'INVENTORY',
      userId: req.user.userId,
      role: req.user.role,
      schoolId: req.user.schoolId,
      details: {
        totalItems: inventoryData.length,
        filename: filename
      }
    });

    // Set response headers for file download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);

    // Write Excel file to response
    await workbook.xlsx.write(res);
    res.end();

    logger.success(`Inventory export completed successfully for school ${req.user.schoolId}: ${inventoryData.length} items exported`);
  } catch (error) {
    logger.error('Export inventory error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error exporting inventory',
      error: error.message
    });
  }
};

module.exports = {
  exportInventoryController
};
