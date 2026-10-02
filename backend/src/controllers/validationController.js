const validationService = require('../services/validationService');

/**
 * Validation Controller (Checkpoint 5)
 *
 * Endpoints:
 * - POST /api/receipts/:id/validation (runs CP5 deterministic policy & duplicate check)
 * - GET  /api/receipts/:id/validation (fetches latest validation results)
 *
 * RBAC: EMPLOYEE (own receipt), MANAGER and FINANCE (tenant receipts).
 */

async function validateReceipt(req, res, next) {
  try {
    const result = await validationService.runValidation(
      req.user.tenantId,
      req.params.id,
      req.user
    );

    return res.status(200).json({ validation: result });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: { message: err.message } });
    }
    next(err);
  }
}

async function getReceiptValidation(req, res, next) {
  try {
    const result = await validationService.getValidation(
      req.user.tenantId,
      req.params.id,
      req.user
    );

    if (!result) {
      return res.status(404).json({ error: { message: 'Validation result not found for this receipt.' } });
    }

    return res.status(200).json({ validation: result });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: { message: err.message } });
    }
    next(err);
  }
}

module.exports = {
  validateReceipt,
  getReceiptValidation,
};
