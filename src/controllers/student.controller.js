const Student = require('../models/Student.js');
const Parent = require('../models/Parent.js');
const User = require('../models/User.js');
const Class = require('../models/Class.js');
const Section = require('../models/Section.js');
const TeacherAssignment = require('../models/TeacherAssignment.js');
const AcademicSession = require('../models/AcademicSession.js');
const { HTTP_STATUS } = require('../config/constants.js');
const { logger } = require('../utils/logger.js');
const { auditLog } = require('../utils/auditLog.js');
const { hashPassword } = require('../utils/password.js');

// Create Student
const createStudent = async (req, res) => {
  try {
    const {
      name,
      rollNumber,
      classId,
      sectionId,
      parentId,
      dateOfBirth,
      gender,
      address,
      mobile,
      email
    } = req.body;

    const schoolId = req.user.schoolId._id || req.user.schoolId;

    let sessionId = req.user.sessionId;
    if (!sessionId) {
      const activeSession = await AcademicSession.findOne({
        schoolId,
        isActive: true
      });
      if (!activeSession) {
        return res.status(400).json({
          success: false,
          message: 'No active academic session found'
        });
      }
      sessionId = activeSession._id;
    }

    // Validate required fields
    if (!name || !rollNumber || !classId || !sectionId || !parentId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'name, rollNumber, classId, sectionId, and parentId are required'
      });
    }

    // Verify session exists and belongs to school
    const session = await AcademicSession.findOne({ _id: sessionId, schoolId });
    if (!session) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Session not found or does not belong to the specified school'
      });
    }

    // Verify class exists and belongs to same school and session
    const classData = await Class.findOne({ _id: classId, schoolId, sessionId });
    if (!classData) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Class not found or does not belong to the specified school and session'
      });
    }

    // Verify section exists and belongs to the class
    const section = await Section.findOne({ _id: sectionId, classId, schoolId, sessionId });
    if (!section) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Section not found or does not belong to the specified class'
      });
    }

    // Verify parent exists and belongs to school
    const parent = await Parent.findOne({ _id: parentId, schoolId })
      .populate('userId', 'mobile');
    if (!parent) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Parent not found or does not belong to the specified school'
      });
    }

    // Check if roll number already exists for this class
    const existingStudent = await Student.findOne({
      rollNumber,
      classId,
      schoolId,
      sessionId
    });
    if (existingStudent) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: `Roll number '${rollNumber}' already exists in this class`
      });
    }

    // Auto-find or create a STUDENT user account
    let studentUser = null;
    if (mobile) {
      studentUser = await User.findOne({ mobile, role: 'STUDENT', schoolId });
    } else if (email) {
      studentUser = await User.findOne({ email: email.toLowerCase(), role: 'STUDENT', schoolId });
    }
    if (!studentUser) {
      const rawPwd = req.body.studentPassword || '123456';
      const hashedPwd = await hashPassword(rawPwd);
      const userPayload = { name, role: 'STUDENT', schoolId, password: hashedPwd };
      if (mobile) userPayload.mobile = mobile;
      if (email) userPayload.email = email.toLowerCase();
      studentUser = await User.create(userPayload);
    }

    // Create student
    const newStudent = await Student.create({
      name,
      rollNumber,
      classId,
      sectionId,
      parentId,
      parentUserId: parent.userId._id,
      userId: studentUser._id,
      schoolId,
      sessionId,
      status: 'ACTIVE',
      dateOfBirth,
      gender,
      address,
      mobile: mobile || parent.userId?.mobile || null
    });

    // Add student to parent's children array
    if (!parent.children.some(id => id.toString() === newStudent._id.toString())) {
      parent.children.push(newStudent._id);
    }
    await parent.save();

    // Audit log
    await auditLog({
      action: 'STUDENT_CREATED',
      userId: req.user.userId,
      schoolId,
      details: {
        studentId: newStudent._id,
        studentName: name,
        rollNumber,
        classId,
        sectionId,
        parentId,
        sessionId
      }
    });

    logger.success(`Student created: ${name} (${rollNumber})`);

    // Auto-create admission bill (best-effort, never fails creation)
    try {
      const Bill = require('../models/Bill');
      const activeSession = await AcademicSession.findOne({
        schoolId, isActive: true
      });
      if (activeSession) {
        const generateBillNumber = (sid) => {
          const ts = Date.now();
          const r = Math.floor(Math.random() * 1000)
            .toString().padStart(3, '0');
          return `BILL-${sid.toString().slice(-4)}-${ts}-${r}`;
        };
        let billNumber;
        let attempts = 0;
        do {
          billNumber = generateBillNumber(schoolId);
          attempts++;
        } while (attempts < 10 && await Bill.findOne({ billNumber }));

        await Bill.create({
          billNumber,
          studentId: newStudent._id,
          schoolId,
          sessionId: activeSession._id,
          billType: 'ADMISSION',
          sourceType: 'Manual',
          description: `Admission Fee — ${newStudent.name}`,
          totalAmount: 0,
          paidAmount: 0,
          dueAmount: 0,
          status: 'PAID',
          createdBy: req.user?._id || newStudent._id
        });
      }
    } catch (billErr) {
      console.error('Admission bill auto-create failed:', billErr.message);
    }

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: 'Student created successfully',
      data: newStudent
    });
  } catch (error) {
    logger.error('Create student error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error creating student',
      error: error.message
    });
  }
};

// Get All Students (with filters)
const getAllStudents = async (req, res) => {
  try {
    const { classId, sectionId, sessionId, status } = req.query;
    const schoolId = req.user.schoolId._id || req.user.schoolId;

    // Build filter
    const filter = { schoolId };
    if (classId) filter.classId = classId;
    if (sectionId) filter.sectionId = sectionId;
    if (sessionId) filter.sessionId = sessionId;
    if (status) filter.status = status;

    // Teachers can only access students from their assigned class/section.
    if (req.user.role === 'TEACHER') {
      const mongoose = require('mongoose');
      const Teacher = require('../models/Teacher.js');
      const teacherProfile = await Teacher.findOne({
        userId:   new mongoose.Types.ObjectId(req.user.userId),
        schoolId: new mongoose.Types.ObjectId(schoolId?._id || schoolId),
      }).select('_id').lean();

      if (!teacherProfile) {
        return res.status(HTTP_STATUS.OK).json({ success: true, count: 0, data: [] });
      }

      const assignments = await TeacherAssignment.find({
        teacherId: teacherProfile._id,
        schoolId,
      })
        .select('classId sectionId')
        .lean();

      const assignedClassIds = [
        ...new Set(assignments.map((a) => a.classId?.toString()).filter(Boolean)),
      ];
      const assignedSectionIds = [
        ...new Set(assignments.map((a) => a.sectionId?.toString()).filter(Boolean)),
      ];

      if (assignedClassIds.length === 0) {
        return res.status(HTTP_STATUS.OK).json({
          success: true,
          count: 0,
          data: [],
        });
      }

      if (classId && !assignedClassIds.includes(classId.toString())) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
          success: false,
          message: 'You are not assigned to this class',
        });
      }

      if (sectionId && !assignedSectionIds.includes(sectionId.toString())) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
          success: false,
          message: 'You are not assigned to this section',
        });
      }

      if (!classId) {
        filter.classId = { $in: assignedClassIds };
      }
      if (!sectionId && assignedSectionIds.length > 0) {
        filter.sectionId = { $in: assignedSectionIds };
      }
    }

    const students = await Student.find(filter)
      .populate('userId', 'name mobile email')
      .populate('classId', 'name')
      .populate('sectionId', 'name')
      .populate({
        path: 'parentId',
        populate: {
          path: 'userId',
          select: 'name mobile email'
        }
      })
      .sort({ createdAt: -1 })
      .lean();

    res.status(HTTP_STATUS.OK).json({
      success: true,
      count: students.length,
      data: students
    });
  } catch (error) {
    logger.error('Get students error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error retrieving students',
      error: error.message
    });
  }
};

// Get Student by ID
const getStudentById = async (req, res) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.schoolId._id || req.user.schoolId;

    const student = await Student.findOne({ _id: id, schoolId })
      .populate('userId', 'name mobile email')
      .populate('classId', 'name')
      .populate('sectionId', 'name')
      .populate({
        path: 'parentId',
        populate: {
          path: 'userId',
          select: 'name mobile email'
        }
      })
      .lean();

    if (!student) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Student not found'
      });
    }

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: student
    });
  } catch (error) {
    logger.error('Get student error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error retrieving student',
      error: error.message
    });
  }
};

// Update Student
const updateStudent = async (req, res) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.schoolId._id || req.user.schoolId;
    const {
      name,
      rollNumber,
      address,
      gender,
      mobile,
      dateOfBirth,
      classId,
      sectionId,
    } = req.body;

    const student = await Student.findOne({ _id: id, schoolId });

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const studentUpdates = {};
    if (name !== undefined) studentUpdates.name = name;
    if (rollNumber !== undefined) studentUpdates.rollNumber = rollNumber;
    if (address !== undefined) studentUpdates.address = address;
    if (gender !== undefined) studentUpdates.gender = gender;
    if (dateOfBirth !== undefined) studentUpdates.dateOfBirth = dateOfBirth;
    if (classId !== undefined) studentUpdates.classId = classId;
    if (sectionId !== undefined) studentUpdates.sectionId = sectionId;
    if (mobile !== undefined) studentUpdates.mobile = mobile;

    if (Object.keys(studentUpdates).length > 0) {
      await Student.findByIdAndUpdate(
        id,
        { $set: studentUpdates },
        { new: true, runValidators: true }
      );
    }

    if (student.userId) {
      const userUpdates = {};
      if (name !== undefined) userUpdates.name = name;

      if (mobile !== undefined && mobile.trim() !== '') {
        const existingUser = await User.findOne({
          mobile: mobile.trim(),
          schoolId,
          _id: { $ne: student.userId },
        });
        if (existingUser) {
          return res.status(409).json({
            success: false,
            message: 'Mobile number is already registered to another user',
          });
        }
        userUpdates.mobile = mobile.trim();
        await Student.findByIdAndUpdate(id, { mobile: mobile.trim() });
      }

      if (Object.keys(userUpdates).length > 0) {
        await User.findByIdAndUpdate(student.userId, { $set: userUpdates });
      }
    }

    const updatedStudent = await Student.findOne({ _id: id, schoolId })
      .populate('userId', 'name mobile email')
      .populate('classId', 'name')
      .populate('sectionId', 'name')
      .populate({
        path: 'parentId',
        populate: { path: 'userId', select: 'name mobile email' },
      });

    return res.status(200).json({
      success: true,
      message: 'Student updated successfully',
      data: updatedStudent,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Duplicate value - roll number or mobile already exists',
      });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Update Student Status (NO DELETE - only status change)
const updateStudentStatus = async (req, res) => {
  try {
    const schoolId = req.user.schoolId._id || req.user.schoolId;
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['ACTIVE', 'INACTIVE'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be ACTIVE or INACTIVE',
      });
    }

    const student = await Student.findOneAndUpdate(
      { _id: id, schoolId },
      { status },
      { new: true }
    );
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: student,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Delete Student (soft-delete by status)
const deleteStudent = async (req, res) => {
  try {
    const schoolId = req.user.schoolId._id || req.user.schoolId;
    const student = await Student.findOneAndUpdate(
      { _id: req.params.id, schoolId },
      { status: 'INACTIVE' },
      { new: true }
    );

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    // Deactivate linked user
    if (student.userId) {
      await User.findByIdAndUpdate(student.userId, { status: 'inactive' });
    }

    return res.status(200).json({ success: true, message: 'Student deactivated' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Link User to Student
const linkUserToStudent = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'userId is required'
      });
    }

    // Find student
    const student = await Student.findById(id);
    if (!student) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Student not found'
      });
    }

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'User not found'
      });
    }

    // Validate user role
    if (user.role !== 'STUDENT') {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'User must have STUDENT role'
      });
    }

    // Validate school match
    if (user.schoolId.toString() !== student.schoolId.toString()) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'User and student must belong to the same school'
      });
    }

    // Link user to student
    student.userId = userId;
    await student.save();

    // Ensure parent.children is updated
    const parent = await Parent.findById(student.parentId);
    if (parent && !parent.children.some(id => id.toString() === student._id.toString())) {
      parent.children.push(student._id);
      await parent.save();
    }

    // Audit log
    await auditLog({
      action: 'STUDENT_USER_LINKED',
      userId: req.user.userId,
      schoolId: req.user.schoolId,
      details: {
        studentId: student._id,
        studentName: student.name,
        linkedUserId: userId,
        linkedUserName: user.name
      }
    });

    logger.success(`Student linked to user: ${student.name} -> ${user.name}`);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Student linked to user successfully',
      data: student
    });
  } catch (error) {
    logger.error('Link user to student error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error linking user to student',
      error: error.message
    });
  }
};

// Move Student to Active Session
const moveStudentToActiveSession = async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolId, sessionId } = req.user;

    const normalizedSchoolId = schoolId._id || schoolId;

    let activeSessionId = sessionId;
    if (!activeSessionId) {
      const activeSession = await AcademicSession.findOne({
        schoolId: normalizedSchoolId,
        isActive: true
      });
      if (!activeSession) {
        return res.status(400).json({ message: 'No active academic session found' });
      }
      activeSessionId = activeSession._id;
    }

    const student = await Student.findById(id);
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    if (student.schoolId.toString() !== normalizedSchoolId.toString()) {
      return res.status(403).json({ message: 'School mismatch' });
    }

    student.sessionId = activeSessionId;
    await student.save();

    res.json({
      success: true,
      message: 'Student moved to active session successfully',
      data: student
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get logged-in student's own profile
const getMyStudentProfile = async (req, res) => {
  try {
    let student = await Student.findOne({ userId: req.user.userId });

    // Failsafe: attempt auto-link if not found
    if (!student) {
      const user = await User.findById(req.user.userId);
      if (user) {
        const query = { schoolId: user.schoolId };
        const orClauses = [];
        if (user.mobile) orClauses.push({ mobile: user.mobile });
        if (user.name)   orClauses.push({ name: user.name });
        if (orClauses.length > 0) query.$or = orClauses;

        student = await Student.findOne(query);
        if (student) {
          student.userId = user._id;
          await student.save();
          console.log(`🔁 Auto-linked during profile fetch: ${user.name} -> ${student._id}`);
        }
      }
    }

    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student profile not linked to this account. Please contact admin.'
      });
    }

    // Re-fetch with full population now that we have the record
    student = await Student.findById(student._id)
      .populate('classId', 'name')
      .populate('sectionId', 'name')
      .populate('schoolId', 'name code address contact')
      .populate('sessionId', 'name startDate endDate');

    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student profile not linked to this account. Please contact admin.'
      });
    }

    res.json({
      success: true,
      data: student
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
};

module.exports = {
  createStudent,
  getAllStudents,
  getStudentById,
  updateStudent,
  deleteStudent,
  updateStudentStatus,
  linkUserToStudent,
  moveStudentToActiveSession,
  getMyStudentProfile
};
