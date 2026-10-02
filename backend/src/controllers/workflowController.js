const workflowService = require('../services/workflowService');

/**
 * Workflow Controller (Checkpoint 6)
 *
 * Handles approval workflow transitions and history inspection.
 */

async function getWorkflow(req, res, next) {
  try {
    const result = await workflowService.getWorkflow(
      req.user.tenantId,
      req.params.id,
      req.user
    );
    return res.status(200).json({ workflow: result });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: { message: err.message } });
    }
    next(err);
  }
}

async function submitExpense(req, res, next) {
  try {
    const result = await workflowService.submitExpense(
      req.user.tenantId,
      req.params.id,
      req.user
    );
    return res.status(200).json({ workflow: result });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: { message: err.message } });
    }
    next(err);
  }
}

async function approveExpense(req, res, next) {
  try {
    const comment = req.body?.comment || null;
    const result = await workflowService.approveExpense(
      req.user.tenantId,
      req.params.id,
      req.user,
      comment
    );
    return res.status(200).json({ workflow: result });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: { message: err.message } });
    }
    next(err);
  }
}

async function rejectExpense(req, res, next) {
  try {
    const reason = req.body?.reason;
    const result = await workflowService.rejectExpense(
      req.user.tenantId,
      req.params.id,
      req.user,
      reason
    );
    return res.status(200).json({ workflow: result });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: { message: err.message } });
    }
    next(err);
  }
}

async function requestCorrection(req, res, next) {
  try {
    const reason = req.body?.reason;
    const result = await workflowService.requestCorrection(
      req.user.tenantId,
      req.params.id,
      req.user,
      reason
    );
    return res.status(200).json({ workflow: result });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: { message: err.message } });
    }
    next(err);
  }
}

module.exports = {
  getWorkflow,
  submitExpense,
  approveExpense,
  rejectExpense,
  requestCorrection,
};
