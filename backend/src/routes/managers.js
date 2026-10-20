const express = require('express');
const { body } = require('express-validator');
const authenticate = require('../middleware/authenticate');
const requireRole = require('../middleware/requireRole');
const managerController = require('../controllers/managerController');

const router = express.Router();

const createManagerValidation = [
  body('firstName')
    .isString()
    .withMessage('First name must be a string')
    .trim()
    .notEmpty()
    .withMessage('First name is required')
    .isLength({ max: 100 })
    .withMessage('First name must not exceed 100 characters'),
  body('lastName')
    .isString()
    .withMessage('Last name must be a string')
    .trim()
    .notEmpty()
    .withMessage('Last name is required')
    .isLength({ max: 100 })
    .withMessage('Last name must not exceed 100 characters'),
  body('email')
    .isEmail()
    .withMessage('Must be a valid email address')
    .normalizeEmail(),
  body('password')
    .isString()
    .withMessage('Password must be a string')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),
];

/**
 * GET /api/managers
 * List all managers in the tenant.
 * RBAC: MANAGER role required.
 */
router.get(
  '/',
  authenticate,
  requireRole('MANAGER'),
  managerController.list
);

/**
 * POST /api/managers
 * Provision a new manager for the tenant.
 * RBAC: MANAGER role required.
 */
router.post(
  '/',
  authenticate,
  requireRole('MANAGER'),
  createManagerValidation,
  managerController.create
);

module.exports = router;
