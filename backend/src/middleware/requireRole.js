/**
 * RBAC authorization middleware factory.
 *
 * Returns Express middleware that checks req.user.role against allowed roles.
 * Must be composed AFTER the authenticate middleware so that req.user is set.
 *
 * SECURITY:
 * - Role is taken from req.user.role, which is set exclusively from the
 *   verified JWT payload in authenticate.js — never from client-controlled input.
 * - 403 is returned without leaking which roles are permitted.
 *
 * Usage:
 *   router.get('/manager-only', authenticate, requireRole('MANAGER'), handler);
 *   router.get('/shared', authenticate, requireRole('MANAGER', 'FINANCE'), handler);
 *
 * @param {...string} roles - Allowed role values ('EMPLOYEE', 'MANAGER', 'FINANCE')
 * @returns {import('express').RequestHandler}
 */
function requireRole(...roles) {
  return function (req, res, next) {
    if (!req.user) {
      // authenticate middleware must run first
      return res.status(401).json({ error: { message: 'Authentication required' } });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: { message: 'Forbidden: insufficient role' } });
    }

    next();
  };
}

module.exports = requireRole;
