const { validationResult } = require('express-validator');
const managerService = require('../services/managerService');

/**
 * Controller for manager directory and provisioning operations.
 */

async function list(req, res, next) {
  try {
    const { search, sortBy, sortOrder } = req.query;
    const managers = await managerService.listManagers(req.user.tenantId, {
      search,
      sortBy,
      sortOrder,
    });
    return res.status(200).json({ managers });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: {
          message: 'Validation failed',
          details: errors.array(),
        },
      });
    }

    const { firstName, lastName, email, password } = req.body;
    const manager = await managerService.createManager(req.user.tenantId, {
      firstName,
      lastName,
      email,
      password,
    });

    return res.status(201).json({ manager });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: { message: err.message } });
    }
    next(err);
  }
}

module.exports = {
  list,
  create,
};
