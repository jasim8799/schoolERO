const Admission = require('../models/Admission');
const Student   = require('../models/Student');
const User      = require('../models/User');
const Parent    = require('../models/Parent');
const { hashPassword } = require('../utils/password');
const { processAdmissionComponentsPayment } = require('../services/paymentEngine.service');
const { autoAssignClassTuitionFee } = require('../services/studentFeeAutoAssign.service');

const getSessionFilter = (req) => {
  const sessionId = req.user?.sessionId;
  return sessionId ? { $or: [{ sessionId }, { sessionId: { $exists: false } }] } : {};
};

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
      // Parent info from admission form
      parentName,
      parentMobile,
      parentEmail,
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

    // ── Step 1: Find or create parent User ────────────────────────────────
    if (parentMobile || parentEmail) {
      let parentUser = null;

      if (parentMobile) {
        parentUser = await User.findOne({ mobile: parentMobile, schoolId });
      }
      if (!parentUser && parentEmail) {
        parentUser = await User.findOne({ email: parentEmail.toLowerCase(), schoolId });
      }

      if (!parentUser) {
        const hashedPwd = await hashPassword('123456');
        const userPayload = {
          name: parentName || 'Parent',
          role: 'PARENT',
          schoolId,
          password: hashedPwd,
          status: 'active',
        };
        if (parentMobile) userPayload.mobile = parentMobile;
        if (parentEmail)  userPayload.email  = parentEmail.toLowerCase();
        parentUser = await User.create(userPayload);
        console.log(`✅ Created parent user: ${parentUser.name} (${parentUser._id})`);
      } else if (parentUser.role !== 'PARENT') {
        await User.findByIdAndUpdate(parentUser._id, { role: 'PARENT' });
        parentUser.role = 'PARENT';
      }

      // ── Step 2: Find or create Parent profile ──────────────────────────
      let parentProfile = await Parent.findOne({ userId: parentUser._id, schoolId });
      if (!parentProfile) {
        parentProfile = await Parent.create({
          userId: parentUser._id,
          schoolId,
          children: [],
          status: 'active',
        });
        console.log(`✅ Created parent profile: ${parentProfile._id}`);
      }

      // ── Step 3: Link student to parent if not already linked ────────────
      let studentDirty = false;
      if (!student.parentId) {
        student.parentId = parentProfile._id;
        student.parentUserId = parentUser._id;
        studentDirty = true;
      }
      if (!student.parentUserId) {
        student.parentUserId = parentUser._id;
        studentDirty = true;
      }

      // ── Step 4: Add student to parent's children array ──────────────────
      if (!parentProfile.children.some(id => id.toString() === studentId.toString())) {
        parentProfile.children.push(studentId);
        await parentProfile.save();
        console.log(`✅ Linked student ${studentId} to parent ${parentProfile._id}`);
      }

      if (studentDirty) await student.save();
    }

    // ── Step 5: Ensure student has a linked User account ──────────────────
    if (!student.userId) {
      const mobile = student.mobile;
      const name   = student.name;
      let studentUser = null;

      if (mobile) {
        studentUser = await User.findOne({ mobile, role: 'STUDENT', schoolId });
      }
      if (!studentUser && name) {
        studentUser = await User.findOne({ name, role: 'STUDENT', schoolId });
      }
      if (!studentUser) {
        const hashedPwd = await hashPassword('123456');
        const userPayload = { name, role: 'STUDENT', schoolId, password: hashedPwd, status: 'active' };
        if (mobile) userPayload.mobile = mobile;
        studentUser = await User.create(userPayload);
        console.log(`✅ Created student user: ${studentUser.name} (${studentUser._id})`);
      }
      student.userId = studentUser._id;
      await student.save();
      console.log(`✅ Linked student ${student.name} -> user ${studentUser._id}`);
    }

    // ── Step 6: Create the Admission record ───────────────────────────────
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
      sessionId:       req.user?.sessionId || req.activeSession?._id || null,
      admissionNumber: admissionNumber || student.admissionNumber || '',
      aadhaarNumber:   aadhaarNumber   || '',
      fees: { admissionFee, discount, finalFee, monthlyFee, dressFee, bookFee, transportFee, hostelFee, totalPayable },
      payLater,
      paymentStatus: payLater ? 'PENDING' : 'PAID',
    });

    // Auto-assign class-wise tuition fee structure for this student.
    // Admission must never fail if no active fee structure exists.
    try {
      const autoAssignResult = await autoAssignClassTuitionFee({
        studentId,
        classId: student.classId,
        schoolId,
        sessionId: req.user?.sessionId || req.activeSession?._id || null,
        assignedBy: req.user._id,
      });

      if (!autoAssignResult.assigned && autoAssignResult.reason === 'NO_ACTIVE_FEE_STRUCTURE') {
        console.warn(
          `[Admission] No active fee structure found for selected class. student=${studentId} class=${student.classId} school=${schoolId}`
        );
      }
    } catch (autoAssignErr) {
      console.error('[Admission] Tuition auto-assignment failed:', autoAssignErr.message);
    }

    if (!payLater) {
      try {
        const components = [];

        if (finalFee > 0) {
          components.push({
            amount: finalFee,
            billType: 'ADMISSION',
            description: `Admission Fee — ${student.name}`,
          });
        }

        const feeTypes = [
          { key: 'monthlyFee', billType: 'TUITION', desc: 'Monthly Fee' },
          { key: 'dressFee', billType: 'DRESS', desc: 'Dress Fee' },
          { key: 'bookFee', billType: 'BOOKS', desc: 'Book Fee' },
          { key: 'transportFee', billType: 'TRANSPORT', desc: 'Transport Fee' },
          { key: 'hostelFee', billType: 'HOSTEL', desc: 'Hostel Fee' },
        ];

        for (const { key, billType, desc } of feeTypes) {
          const amt = Number(fees[key]) || 0;
          if (amt <= 0) continue;
          components.push({
            amount: amt,
            billType,
            description: `Admission — ${desc} — ${student.name}`,
          });
        }

        await processAdmissionComponentsPayment({
          schoolId,
          actorId: req.user._id,
          reqSessionId: req.user?.sessionId,
          studentId,
          admissionId: admission._id,
          components,
          paymentMode: 'Cash',
        });
      } catch (billErr) {
        console.error('Admission fee bill dual-write failed:', billErr.message);
      }
    }

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

// GET /api/admissions — list all admissions for a school
exports.getAllAdmissions = async (req, res) => {
  try {
    const schoolId = req.user.schoolId._id || req.user.schoolId;
    const { studentId } = req.query;
    const filter = { schoolId };
    Object.assign(filter, getSessionFilter(req));
    if (studentId) filter.studentId = studentId;

    const admissions = await Admission.find(filter)
      .populate({
        path: 'studentId',
        select: 'name rollNumber admissionNumber userId',
        populate: { path: 'userId', select: 'name mobile' },
      })
      .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, data: admissions });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/admissions/student/:studentId
exports.getAdmissionByStudent = async (req, res) => {
  try {
    const schoolId = req.user.schoolId._id || req.user.schoolId;
    const { studentId } = req.params;

    const admissions = await Admission.find({ studentId, schoolId, ...getSessionFilter(req) })
      .populate('studentId', 'name rollNumber admissionNumber')
      .sort({ createdAt: -1 })
      .lean();

    const sanitized = admissions.map((adm) => {
      if (adm.documents) {
        for (const docType of ['aadhaar', 'birthCertificate', 'photo', 'tc', 'parentAadhaar']) {
          if (adm.documents[docType]) {
            delete adm.documents[docType].dataUrl;
          }
        }
      }
      return adm;
    });

    return res.status(200).json({ success: true, data: sanitized });
  } catch (err) {
    console.error('getAdmissionByStudent error:', err);
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};

// GET /api/admissions/:id/documents/:docType/data
exports.getDocumentData = async (req, res) => {
  try {
    const { id, docType } = req.params;
    const schoolId = req.user.schoolId._id || req.user.schoolId;

    const validDocTypes = ['aadhaar', 'birthCertificate', 'photo', 'tc', 'parentAadhaar'];
    if (!validDocTypes.includes(docType)) {
      return res.status(400).json({ success: false, message: 'Invalid document type' });
    }

    const admission = await Admission.findOne({ _id: id, schoolId, ...getSessionFilter(req) }).select(
      `+documents.${docType}.dataUrl documents.${docType}.fileName documents.${docType}.uploadedAt`
    );

    if (!admission) {
      return res.status(404).json({ success: false, message: 'Admission not found' });
    }

    const docData = admission.documents?.[docType];
    if (!docData?.dataUrl) {
      return res.status(404).json({ success: false, message: 'Document data not found' });
    }

    return res.status(200).json({
      success: true,
      data: {
        fileName: docData.fileName,
        uploadedAt: docData.uploadedAt,
        dataUrl: docData.dataUrl,
        docType,
      },
    });
  } catch (err) {
    console.error('getDocumentData error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/admissions/student/:studentId/photo
exports.getStudentPhoto = async (req, res) => {
  try {
    const { studentId } = req.params;
    const schoolId = req.user.schoolId._id || req.user.schoolId;

    const admission = await Admission.findOne({ studentId, schoolId, ...getSessionFilter(req) }).select(
      '+documents.photo.dataUrl documents.photo.fileName'
    );

    if (!admission || !admission.documents?.photo?.dataUrl) {
      return res.status(404).json({ success: false, message: 'No photo found' });
    }

    return res.status(200).json({
      success: true,
      data: { dataUrl: admission.documents.photo.dataUrl },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/admissions/:id — update admission (Principal/Operator only)
exports.updateAdmission = async (req, res) => {
  try {
    const schoolId = req.user.schoolId._id || req.user.schoolId;
    const updateData = {};

    for (const [key, value] of Object.entries(req.body || {})) {
      if (key === 'documents' && value && typeof value === 'object') {
        for (const [docType, docData] of Object.entries(value)) {
          if (!docData || typeof docData !== 'object') continue;
          for (const [field, fieldValue] of Object.entries(docData)) {
            if (field !== 'dataUrl') {
              console.log(
                `Saving document field: documents.${docType}.${field} = ${fieldValue}`
              );
            } else {
              console.log(
                `Saving document field: documents.${docType}.dataUrl = [base64 data, ${String(fieldValue).length} chars]`
              );
            }
            updateData[`documents.${docType}.${field}`] = fieldValue;
          }
        }
      } else {
        updateData[key] = value;
      }
    }

    console.log('updateAdmission update keys:', Object.keys(updateData));

    const admission = await Admission.findOneAndUpdate(
      { _id: req.params.id, schoolId },
      { $set: updateData },
      { new: true, runValidators: false }
    );
    if (!admission) {
      return res.status(404).json({ success: false, message: 'Admission not found' });
    }

    const docSummary = {};
    if (admission.documents) {
      const docs = admission.documents.toObject
        ? admission.documents.toObject()
        : admission.documents;
      for (const [docType, docData] of Object.entries(docs)) {
        docSummary[docType] = {
          fileName: docData?.fileName || null,
          uploadedAt: docData?.uploadedAt || null,
          hasData: !!docData?.dataUrl,
        };
      }
    }

    return res.status(200).json({
      success: true,
      data: admission,
      documentsSummary: docSummary,
    });
  } catch (err) {
    console.error('updateAdmission error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/admissions/:id — cancel admission (Principal only)
exports.deleteAdmission = async (req, res) => {
  try {
    const schoolId = req.user.schoolId._id || req.user.schoolId;
    const admission = await Admission.findOneAndUpdate(
      { _id: req.params.id, schoolId },
      { status: 'CANCELLED' },
      { new: true }
    );
    if (!admission) {
      return res.status(404).json({ success: false, message: 'Admission not found' });
    }
    return res.status(200).json({ success: true, message: 'Admission cancelled' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
