const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema(
  {
    fileName:  { type: String, default: null },
    uploadedAt: { type: Date, default: null },
  },
  { _id: false }
);

const feesSchema = new mongoose.Schema(
  {
    admissionFee: { type: Number, default: 0 },
    discount:     { type: Number, default: 0 },
    finalFee:     { type: Number, default: 0 },
    monthlyFee:   { type: Number, default: 0 },
    dressFee:     { type: Number, default: 0 },
    bookFee:      { type: Number, default: 0 },
    transportFee: { type: Number, default: 0 },
    hostelFee:    { type: Number, default: 0 },
    totalPayable: { type: Number, default: 0 },
  },
  { _id: false }
);

const admissionSchema = new mongoose.Schema(
  {
    studentId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    schoolId:        { type: mongoose.Schema.Types.ObjectId, ref: 'School',  required: true },
    sessionId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Session'  },
    admissionNumber: { type: String, default: '' },
    aadhaarNumber:   { type: String, default: '' },
    documents: {
      aadhaar:          { type: documentSchema, default: () => ({}) },
      birthCertificate: { type: documentSchema, default: () => ({}) },
      photo:            { type: documentSchema, default: () => ({}) },
      tc:               { type: documentSchema, default: () => ({}) },
    },
    fees:          { type: feesSchema, default: () => ({}) },
    paymentStatus: {
      type:    String,
      enum:    ['PENDING', 'PARTIAL', 'PAID'],
      default: 'PENDING',
    },
    payLater: { type: Boolean, default: false },
    status:   {
      type:    String,
      enum:    ['ACTIVE', 'CANCELLED'],
      default: 'ACTIVE',
    },
  },
  { timestamps: true }
);

admissionSchema.index({ studentId: 1 }, { unique: true });
admissionSchema.index({ schoolId: 1 });

module.exports = mongoose.model('Admission', admissionSchema);
