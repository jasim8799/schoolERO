const PERMISSION_MATRIX = {
  SUPER_ADMIN: ['*'],
  PRINCIPAL: [
    'school:read', 'school:update',
    'users:read', 'users:create:operator', 'users:create:teacher',
    'students:read', 'students:create', 'students:update',
    'attendance:read', 'attendance:write',
    'fees:read', 'fees:write',
    'exams:read', 'exams:write',
    'reports:read', 'reports:generate',
    'sessions:read', 'sessions:create',
    'modules:read',
    'analytics:read',
    'audit:read'
  ],
  OPERATOR: [
    'students:read', 'students:create', 'students:update',
    'attendance:read', 'attendance:write',
    'fees:read', 'fees:write',
    'exams:read',
    'reports:read'
  ],
  TEACHER: [
    'attendance:read', 'attendance:write:own',
    'exams:read', 'exams:write:own',
    'homework:read', 'homework:write:own',
    'students:read:own-class'
  ],
  STUDENT: [
    'attendance:read:own',
    'exams:read:own',
    'fees:read:own',
    'homework:read:own'
  ],
  PARENT: [
    'attendance:read:own-child',
    'fees:read:own-child',
    'exams:read:own-child',
    'notices:read'
  ],
  ACCOUNTANT: [
    'fees:read', 'fees:write',
    'expenses:read', 'expenses:write',
    'salary:read', 'salary:write',
    'reports:read'
  ],
  LIBRARIAN: [
    'library:read', 'library:write',
    'students:read'
  ],
  TRANSPORT_MANAGER: [
    'transport:read', 'transport:write',
    'students:read'
  ]
};

function hasPermission(role, permission) {
  const perms = PERMISSION_MATRIX[role] || [];
  return perms.includes('*') || perms.includes(permission);
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    if (!hasPermission(req.user.role, permission)) {
      return res.status(403).json({ success: false, message: `Permission denied: ${permission}` });
    }

    return next();
  };
}

module.exports = { requirePermission, hasPermission, PERMISSION_MATRIX };
