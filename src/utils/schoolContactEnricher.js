const User = require('../models/User.js');
const { USER_ROLES } = require('../config/constants.js');

const clean = (value) => {
  if (value == null) return '';
  return value.toString().trim();
};

const pickFirst = (values) => {
  for (const value of values) {
    const text = clean(value);
    if (!text) continue;
    const upper = text.toUpperCase();
    if (upper === 'N/A' || upper === 'NULL' || upper === 'UNDEFINED') continue;
    return text;
  }
  return '';
};

const asMap = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
};

const extractSchoolId = (school) => {
  const s = asMap(school);
  return s._id || s.id || s.schoolId || null;
};

const extractPrincipalEmailFromSchool = (school) => {
  const s = asMap(school);
  const contact = asMap(s.contact);
  const principal = asMap(s.principal);
  const principalUser = asMap(s.principalUser);
  const principalId = asMap(s.principalId);
  const principalContact = asMap(principal.contact);

  return pickFirst([
    contact.email,
    s.email,
    s.contactEmail,
    principal.email,
    s.principalEmail,
    principalUser.email,
    principalId.email,
    principal.emailAddress,
    principalContact.email,
  ]);
};

const findPrincipalForSchool = async (schoolId) => {
  if (!schoolId) return null;

  const principal = await User.findOne({
    schoolId,
    role: USER_ROLES.PRINCIPAL,
  })
    .select('_id name email mobile')
    .sort({ createdAt: 1 })
    .lean();

  return principal || null;
};

const attachPrincipalEmailToSchool = async (school) => {
  const source = school && typeof school.toObject === 'function'
    ? school.toObject()
    : asMap(school);

  if (!source || Object.keys(source).length === 0) return source;

  const enriched = { ...source };
  const existingEmail = extractPrincipalEmailFromSchool(enriched);
  if (existingEmail) {
    if (!clean(enriched.principalEmail)) {
      enriched.principalEmail = existingEmail;
    }
    return enriched;
  }

  const schoolId = extractSchoolId(enriched);
  if (!schoolId) return enriched;

  const principal = await findPrincipalForSchool(schoolId);
  if (!principal || !clean(principal.email)) return enriched;

  enriched.principalEmail = principal.email;
  if (!asMap(enriched.principal).email) {
    enriched.principal = {
      ...asMap(enriched.principal),
      email: principal.email,
      name: principal.name,
    };
  }
  if (!asMap(enriched.principalUser).email) {
    enriched.principalUser = {
      ...asMap(enriched.principalUser),
      _id: principal._id,
      email: principal.email,
      name: principal.name,
    };
  }

  return enriched;
};

module.exports = {
  attachPrincipalEmailToSchool,
};
