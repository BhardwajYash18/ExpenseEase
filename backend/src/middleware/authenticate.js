const authService = require('../services/authService');

/**
 * Authentication middleware.
 *
 * Extracts and verifies the JWT from the Authorization header.
 * On success, populates req.user from the verified JWT payload ONLY.
 *
 * SECURITY:
 * - req.user.id, req.user.tenantId, and req.user.role are derived
 *   exclusively from the verified JWT — never from req.body, req.query,
 *   req.params, or any other client-controlled request field.
 * - Algorithm is pinned to HS256 inside authService.verifyToken.
 * - On any failure, responds with a generic 401 and no implementation detail.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: { message: 'Authentication required' } });
  }

  const token = authHeader.slice(7); // Remove "Bearer " prefix

  try {
    // verifyToken: validates signature, expiry, algorithm (HS256 only), and required claims
    const decoded = authService.verifyToken(token);

    // Populate req.user from JWT claims only.
    // These values come from the signed, server-issued token — not from any client input.
    req.user = {
      id: decoded.sub,
      tenantId: decoded.tid,
      role: decoded.role,
    };

    next();
  } catch (_) {
    // Generic message — do not expose verification failure detail
    return res.status(401).json({ error: { message: 'Invalid or expired token' } });
  }
}

module.exports = authenticate;
