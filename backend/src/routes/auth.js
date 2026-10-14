const express = require('express');
const { body } = require('express-validator');
const authController = require('../controllers/authController');
const authenticate = require('../middleware/authenticate');

const router = express.Router();

// Input validation rules for unified login
const loginValidation = [
  body('email')
    .optional()
    .isEmail()
    .withMessage('email must be a valid email address')
    .normalizeEmail(),
  body('loginId')
    .optional()
    .isString()
    .trim(),
  body().custom((value) => {
    if ((!value.email || !value.email.trim()) && (!value.loginId || !value.loginId.trim())) {
      throw new Error('A unique login ID or email address is required');
    }
    return true;
  }),
  body('password')
    .isString()
    .withMessage('password must be a string')
    .notEmpty()
    .withMessage('password is required'),
  body('slug')
    .isString()
    .withMessage('slug must be a string')
    .notEmpty()
    .withMessage('slug is required')
    .trim(),
];

/**
 * POST /api/auth/login
 * Authenticate a user and receive a JWT.
 * Body: { email: string, password: string, slug: string }
 *
 * ASSUMPTION: `slug` is the company tenant slug used to resolve the tenant
 * before authentication. Required because email uniqueness is per-tenant.
 */
router.post('/login', loginValidation, authController.login);

/**
 * GET /api/auth/me
 * Returns the authenticated user's identity derived from the verified JWT.
 * Requires: Authorization: Bearer <token>
 */
router.get('/me', authenticate, authController.me);

module.exports = router;
