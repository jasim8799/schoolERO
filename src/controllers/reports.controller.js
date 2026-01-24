const { USER_ROLES } = require('../config/constants');
const AcademicHistory = require('../models/AcademicHistory');
const TC = require('../models/TC');
const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');

const exportProfitLossExcel = (report, res) => {
  const data = [
    { Category: 'Fee Collection', Amount: report.income.feeCollection },
    { Category: 'Online Payments', Amount: report.income.onlinePayments },
    { Category: 'Exam Payments', Amount: report.income.examPayments },
    { Category: 'Total Income', Amount: report.income.totalIncome },
    { Category: 'Expenses', Amount: report.expenditure.expenses },
    { Category: 'Salaries', Amount: report.expenditure.salaries },
    { Category: 'Total Expenditure', Amount: report.expenditure.totalExpenditure },
    { Category: 'Net Profit/Loss', Amount: report.summary.netProfit }
  ];
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ProfitLoss');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=profit-loss.xlsx');
  res.send(buffer);
};

// Get profit loss report
const getProfitLossReport = async (req, res) => {
  try {
    const { sessionId } = req.query;
    const { schoolId, role } = req.user;

    // Role-based access
    if (role === USER_ROLES.STUDENT || role === USER_ROLES.PARENT || role === USER_ROLES.TEACHER) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Placeholder implementation
    const report = {
      type: 'profit_loss',
      sessionId: sessionId || 'All',
      income: {
        feeCollection: 0,
        onlinePayments: 0,
        examPayments: 0,
        totalIncome: 0
      },
      expenditure: {
        expenses: 0,
        salaries: 0,
        totalExpenditure: 0
      },
      summary: {
        netProfit: 0
      }
    };

    // Handle export
    if (req.query.export === 'excel') {
      return exportProfitLossExcel(report, res);
    }

    res.json(report);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get promotion report
const getPromotionReport = async (req, res) => {
  try {
    const { sessionId } = req.query;
    const { schoolId, role } = req.user;

    // Role-based access
    if (role === USER_ROLES.STUDENT || role === USER_ROLES.PARENT || role === USER_ROLES.TEACHER) {
      return res.status(403).json({ message: 'Access denied' });
    }

    let filter = { schoolId, promoted: true };
    if (sessionId) filter.sessionId = sessionId;

    const promotions = await AcademicHistory.find(filter)
      .populate('studentId', 'userId rollNumber')
      .populate('studentId.userId', 'name')
      .populate('sessionId', 'name')
      .populate('classId', 'name')
      .populate('sectionId', 'name')
      .sort({ 'studentId.userId.name': 1 });

    const report = {
      type: 'promotions',
      sessionId: sessionId || 'All',
      summary: {
        totalPromotions: promotions.length
      },
      promotions: promotions.map(p => ({
        studentId: p.studentId._id,
        studentName: p.studentId.userId.name,
        rollNumber: p.studentId.rollNumber,
        session: p.sessionId.name,
        fromClass: p.classId.name,
        fromSection: p.sectionId?.name || 'N/A',
        attendancePercentage: p.attendanceSummary?.percentage || 0,
        overallGrade: p.resultSummary?.overallGrade || 'N/A',
        promoted: p.status === 'Promoted',
        remarks: p.resultSummary?.remarks || 'N/A'
      }))
    };

    // Handle export
    if (req.query.export === 'pdf') {
      return exportPromotionPDF(report, res);
    } else if (req.query.export === 'excel') {
      return exportPromotionExcel(report, res);
    }

    res.json(report);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get retention report
const getRetentionReport = async (req, res) => {
  try {
    const { sessionId } = req.query;
    const { schoolId, role } = req.user;

    // Role-based access
    if (role === USER_ROLES.STUDENT || role === USER_ROLES.PARENT || role === USER_ROLES.TEACHER) {
      return res.status(403).json({ message: 'Access denied' });
    }

    let filter = { schoolId, promoted: false };
    if (sessionId) filter.sessionId = sessionId;

    const retentions = await AcademicHistory.find(filter)
      .populate('studentId', 'userId rollNumber')
      .populate('studentId.userId', 'name')
      .populate('sessionId', 'name')
      .populate('classId', 'name')
      .populate('sectionId', 'name')
      .sort({ 'studentId.userId.name': 1 });

    const report = {
      type: 'retentions',
      sessionId: sessionId || 'All',
      summary: {
        totalRetentions: retentions.length
      },
      retentions: retentions.map(r => ({
        studentId: r.studentId._id,
        studentName: r.studentId.userId.name,
        rollNumber: r.studentId.rollNumber,
        session: r.sessionId.name,
        class: r.classId.name,
        section: r.sectionId?.name || 'N/A',
        attendancePercentage: r.attendanceSummary?.percentage || 0,
        overallGrade: r.resultSummary?.overallGrade || 'N/A',
        promoted: r.status === 'Promoted',
        remarks: r.resultSummary?.remarks || 'N/A'
      }))
    };

    // Handle export
    if (req.query.export === 'pdf') {
      return exportRetentionPDF(report, res);
    } else if (req.query.export === 'excel') {
      return exportRetentionExcel(report, res);
    }

    res.json(report);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get TC report
const getTCReport = async (req, res) => {
  try {
    const { sessionId } = req.query;
    const { schoolId, role } = req.user;

    // Role-based access
    if (role === USER_ROLES.STUDENT || role === USER_ROLES.PARENT || role === USER_ROLES.TEACHER) {
      return res.status(403).json({ message: 'Access denied' });
    }

    let filter = { schoolId };
    if (sessionId) filter.sessionId = sessionId;

    const tcs = await TC.find(filter)
      .populate('studentId', 'userId rollNumber')
      .populate('studentId.userId', 'name')
      .populate('sessionId', 'name')
      .populate('issuedBy', 'name')
      .sort({ issueDate: -1 });

    const report = {
      type: 'transfer_certificates',
      sessionId: sessionId || 'All',
      summary: {
        totalTCs: tcs.length
      },
      tcs: tcs.map(tc => ({
        tcId: tc._id,
        tcNumber: tc.tcNumber,
        studentId: tc.studentId._id,
        studentName: tc.studentId.userId.name,
        rollNumber: tc.studentId.rollNumber,
        session: tc.sessionId.name,
        issueDate: tc.issueDate,
        reason: tc.reason,
        issuedBy: tc.issuedBy.name,
        remarks: tc.remarks
      }))
    };

    // Handle export
    if (req.query.export === 'pdf') {
      return exportTCPDF(report, res);
    } else if (req.query.export === 'excel') {
      return exportTCExcel(report, res);
    }

    res.json(report);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get session-wise academic history report
const getHistoryReport = async (req, res) => {
  try {
    const { sessionId } = req.query;
    const { schoolId, role } = req.user;

    // Role-based access
    if (role === USER_ROLES.STUDENT || role === USER_ROLES.PARENT || role === USER_ROLES.TEACHER) {
      return res.status(403).json({ message: 'Access denied' });
    }

    let filter = { schoolId };
    if (sessionId) filter.sessionId = sessionId;

    const histories = await AcademicHistory.find(filter)
      .populate('studentId', 'userId rollNumber')
      .populate('studentId.userId', 'name')
      .populate('sessionId', 'name')
      .populate('classId', 'name')
      .populate('sectionId', 'name')
      .sort({ 'sessionId.name': 1, 'studentId.userId.name': 1 });

    const report = {
      type: 'academic_history',
      sessionId: sessionId || 'All',
      summary: {
        totalRecords: histories.length
      },
      histories: histories.map(h => ({
        studentId: h.studentId._id,
        studentName: h.studentId.userId.name,
        rollNumber: h.studentId.rollNumber,
        session: h.sessionId.name,
        class: h.classId.name,
        section: h.sectionId?.name || 'N/A',
        attendancePercentage: h.attendanceSummary?.percentage || 0,
        totalSubjects: h.resultSummary?.subjects?.length || 0,
        subjects: h.resultSummary?.subjects || [],
        overallGrade: h.resultSummary?.overallGrade || 'N/A',
        promoted: h.status === 'Promoted',
        remarks: h.resultSummary?.remarks || 'N/A'
      }))
    };

    // Handle export
    if (req.query.export === 'pdf') {
      return exportHistoryPDF(report, res);
    } else if (req.query.export === 'excel') {
      return exportHistoryExcel(report, res);
    }

    res.json(report);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Placeholder export functions for promotion and TC reports
const exportPromotionPDF = (report, res) => {
  const doc = new PDFDocument();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename=promotions.pdf');
  doc.pipe(res);
  doc.fontSize(20).text('Promotion Report', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`Session: ${report.sessionId}, Total Promotions: ${report.summary.totalPromotions}`);
  doc.end();
};

const exportPromotionExcel = (report, res) => {
  const data = report.promotions.map(p => ({
    StudentName: p.studentName,
    RollNumber: p.rollNumber,
    Session: p.session,
    FromClass: p.fromClass,
    FromSection: p.fromSection,
    AttendancePercentage: p.attendancePercentage,
    OverallGrade: p.overallGrade,
    Promoted: p.promoted ? 'Yes' : 'No',
    Remarks: p.remarks
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Promotions');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=promotions.xlsx');
  res.send(buffer);
};

const exportRetentionPDF = (report, res) => {
  const doc = new PDFDocument();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename=retentions.pdf');
  doc.pipe(res);
  doc.fontSize(20).text('Retention Report', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`Session: ${report.sessionId}, Total Retentions: ${report.summary.totalRetentions}`);
  doc.end();
};

const exportRetentionExcel = (report, res) => {
  const data = report.retentions.map(r => ({
    StudentName: r.studentName,
    RollNumber: r.rollNumber,
    Session: r.session,
    Class: r.class,
    Section: r.section,
    AttendancePercentage: r.attendancePercentage,
    OverallGrade: r.overallGrade,
    Promoted: r.promoted ? 'Yes' : 'No',
    Remarks: r.remarks
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Retentions');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=retentions.xlsx');
  res.send(buffer);
};

const exportTCPDF = (report, res) => {
  const doc = new PDFDocument();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename=transfer-certificates.pdf');
  doc.pipe(res);
  doc.fontSize(20).text('Transfer Certificates Report', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`Session: ${report.sessionId}, Total TCs: ${report.summary.totalTCs}`);
  doc.end();
};

const exportTCExcel = (report, res) => {
  const data = report.tcs.map(tc => ({
    TCNumber: tc.tcNumber,
    StudentName: tc.studentName,
    RollNumber: tc.rollNumber,
    Session: tc.session,
    IssueDate: tc.issueDate,
    Reason: tc.reason,
    IssuedBy: tc.issuedBy,
    Remarks: tc.remarks
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'TransferCertificates');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=transfer-certificates.xlsx');
  res.send(buffer);
};

const exportHistoryPDF = (report, res) => {
  const doc = new PDFDocument();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename=academic-history.pdf');
  doc.pipe(res);
  doc.fontSize(20).text('Academic History Report', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`Session: ${report.sessionId}, Total Records: ${report.summary.totalRecords}`);
  doc.end();
};

const exportHistoryExcel = (report, res) => {
  const data = [];
  report.histories.forEach(h => {
    const subjects = h.subjects || [];
    if (subjects.length > 0) {
      subjects.forEach(s => {
        data.push({
          StudentName: h.studentName,
          RollNumber: h.rollNumber,
          Session: h.session,
          Class: h.class,
          Section: h.section,
          AttendancePercentage: h.attendancePercentage,
          Subject: s.name,
          Marks: s.marks,
          Grade: s.grade,
          Status: s.status,
          OverallGrade: h.overallGrade,
          Promoted: h.promoted ? 'Yes' : 'No',
          Remarks: h.remarks
        });
      });
    } else {
      // If no subjects, add a row with basic student info
      data.push({
        StudentName: h.studentName,
        RollNumber: h.rollNumber,
        Session: h.session,
        Class: h.class,
        Section: h.section,
        AttendancePercentage: h.attendancePercentage,
        Subject: 'N/A',
        Marks: 'N/A',
        Grade: 'N/A',
        Status: 'N/A',
        OverallGrade: h.overallGrade,
        Promoted: h.promoted ? 'Yes' : 'No',
        Remarks: h.remarks
      });
    }
  });
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'AcademicHistory');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=academic-history.xlsx');
  res.send(buffer);
};

module.exports = {
  getProfitLossReport,
  getPromotionReport,
  getRetentionReport,
  getTCReport,
  getHistoryReport
};
