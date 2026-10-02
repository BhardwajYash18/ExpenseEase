const extractionService = require('../services/extractionService');

/**
 * Extraction Controller (Checkpoint 4)
 *
 * Handles HTTP requests for:
 * - POST /api/receipts/:id/extraction (trigger AI extraction)
 * - GET  /api/receipts/:id/extraction (fetch extraction and effective values)
 * - PUT  /api/receipts/:id/extraction (human confirmation/correction)
 *
 * RBAC: EMPLOYEE, MANAGER, FINANCE
 * - EMPLOYEE: strictly limited to receipts they uploaded
 * - MANAGER / FINANCE: limited to receipts in their authenticated tenant
 */

async function trigger(req, res, next) {
  try {
    const result = await extractionService.triggerExtraction(
      req.user.tenantId,
      req.params.id,
      req.user
    );

    return res.status(200).json({ extraction: result });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: { message: err.message } });
    }
    next(err);
  }
}

async function get(req, res, next) {
  try {
    const result = await extractionService.getExtraction(
      req.user.tenantId,
      req.params.id,
      req.user
    );

    if (!result) {
      return res.status(404).json({ error: { message: 'Extraction not found' } });
    }

    return res.status(200).json({ extraction: result });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: { message: err.message } });
    }
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const confirmedData = req.body || {};
    const result = await extractionService.updateExtraction(
      req.user.tenantId,
      req.params.id,
      req.user,
      confirmedData
    );

    return res.status(200).json({ extraction: result });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: { message: err.message } });
    }
    next(err);
  }
}

module.exports = {
  trigger,
  get,
  update,
};
