const { validationResult } = require('express-validator');
const authService = require('../services/authService');

/**
 * POST /api/auth/login
 * Authenticates a user and returns a JWT.
 * Accepts: { email, password, slug } — slug identifies the company tenant.
 */
async function login(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: { message: 'Validation failed', details: errors.array() } });
    }

    const { email, password, slug } = req.body;

    const result = await authService.login({ email, password, tenantSlug: slug });

    return res.status(200).json({
      token: result.token,
      user: result.user,
    });
  } catch (err) {
    if (err.status === 401) {
      // Generic message — do not hint at what was wrong (slug, email, or password)
      return res.status(401).json({ error: { message: 'Invalid credentials' } });
    }
    next(err);
  }
}

/**
 * GET /api/auth/me
 * Returns the authenticated user's identity from the verified JWT.
 * req.user is populated exclusively by the authenticate middleware.
 */
function me(req, res) {
  // req.user is set by authenticate middleware from JWT claims only.
  // password_hash is never present in req.user.
  return res.status(200).json({ user: req.user });
}

module.exports = { login, me };
