const Admission = require('../models/Admission');
const Student   = require('../models/Student');

// POST /api/admissions
exports.createAdmission = async (req, res) => {
  try {
    const schoolId = req.user.schoolId._id || req.user.schoolId;
    const {
      studentId,
      admissionNumber,
      aadhaarNumber,
      fees = {},
      payLater = false,
    } = req.body;

    if (!studentId) {
      return res.status(400).json({ success: false, message: 'studentId is required' });
    }

    // Verify the student belongs to this school
    const student = await Student.findOne({ _id: studentId, schoolId });
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    // Prevent duplicate admission records
    const existing = await Admission.findOne({ studentId });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Admission record already exists for this student' });
    }

    // Server-side fee computation
    const admissionFee = Number(fees.admissionFee) || 0;
    const discount     = Number(fees.discount)     || 0;
    const finalFee     = Math.max(admissionFee - discount, 0);
    const monthlyFee   = Number(fees.monthlyFee)   || 0;
    const dressFee     = Number(fees.dressFee)     || 0;
    const bookFee      = Number(fees.bookFee)      || 0;
    const transportFee = Number(fees.transportFee) || 0;
    const hostelFee    = Number(fees.hostelFee)    || 0;
    const totalPayable = finalFee + monthlyFee + dressFee + bookFee + transportFee + hostelFee;

    const admission = await Admission.create({
      studentId,
      schoolId,
      sessionId:       req.activeSession?._id || null,
      admissionNumber: admissionNumber || student.admissionNumber || '',
      aadhaarNumber:   aadhaarNumber   || '',
      fees: { admissionFee, discount, finalFee, monthlyFee, dressFee, bookFee, transportFee, hostelFee, totalPayable },
      payLater,
      paymentStatus: payLater ? 'PENDING' : 'PAID',
    });

    // Back-fill admissionNumber on the Student doc if provided
    if (admissionNumber && !student.admissionNumber) {
      await Student.findByIdAndUpdate(studentId, { admissionNumber });
    }

    return res.status(201).json({ success: true, data: admission });
  } catch (err) {
    console.error('createAdmission error:', err);
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};

// GET /api/admissions/student/:studentId
exports.getAdmissionByStudent = async (req, res) => {
  try {
    const schoolId  = req.user.schoolId._id || req.user.schoolId;
    const { studentId } = req.params;

    const admission = await Admission.findOne({ studentId, schoolId }).populate('studentId', 'name rollNumber');
    if (!admission) {
      return res.status(404).json({ success: false, message: 'No admission record found' });
    }

    return res.status(200).json({ success: true, data: admission });
  } catch (err) {
    console.error('getAdmissionByStudent error:', err);
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};
