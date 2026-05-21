function tenantIsolation(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, message: 'Not authenticated' });

  const schoolId = req.user.schoolId;
  if (!schoolId && req.user.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ success: false, message: 'Tenant context missing' });
  }

  req.tenantId = schoolId || null;
  return next();
}

module.exports = { tenantIsolation };
