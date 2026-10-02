const financeBatchService = require('../services/financeBatchService');

/**
 * Finance Batch Controller (Checkpoint 7)
 *
 * Exposes REST API handlers for finance batch operations.
 * Middleware chain enforces:
 * authenticateToken -> requireTenantContext -> requireRole('FINANCE')
 */

/**
 * GET /api/finance-batches/eligible-expenses
 * List all approved expenses eligible for batching.
 */
async function getEligibleApprovedExpenses(req, res, next) {
  try {
    const tenantId = req.user.tenantId;
    const expenses = await financeBatchService.getEligibleApprovedExpenses(tenantId);
    res.json({
      success: true,
      count: expenses.length,
      expenses,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/finance-batches
 * List all finance batches for the tenant.
 */
async function getBatches(req, res, next) {
  try {
    const tenantId = req.user.tenantId;
    const batches = await financeBatchService.getBatches(tenantId);
    res.json({
      success: true,
      count: batches.length,
      batches,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/finance-batches/:id
 * Retrieve details of a single finance batch.
 */
async function getBatchById(req, res, next) {
  try {
    const tenantId = req.user.tenantId;
    const batchId = req.params.id;

    const batch = await financeBatchService.getBatchById(tenantId, batchId);
    if (!batch) {
      return res.status(404).json({
        error: { message: 'Finance batch not found' },
      });
    }

    res.json({
      success: true,
      batch,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/finance-batches
 * Create a new finance batch grouping approved expenses.
 * Body: { receiptIds }
 */
async function createBatch(req, res, next) {
  try {
    const tenantId = req.user.tenantId;
    const userId = req.user.id;
    const userRole = req.user.role;
    const { receiptIds } = req.body;

    const batch = await financeBatchService.createBatch(tenantId, userId, userRole, {
      receiptIds,
    });

    res.status(201).json({
      success: true,
      message: 'Finance batch created successfully',
      batch,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/finance-batches/:id/items
 * Add an approved expense to an open finance batch.
 * Body: { receiptId }
 */
async function addExpenseToBatch(req, res, next) {
  try {
    const tenantId = req.user.tenantId;
    const userId = req.user.id;
    const userRole = req.user.role;
    const batchId = req.params.id;
    const { receiptId } = req.body;

    if (!receiptId) {
      return res.status(400).json({
        error: { message: 'receiptId is required in request body' },
      });
    }

    const batch = await financeBatchService.addExpenseToBatch(
      tenantId,
      userId,
      userRole,
      batchId,
      receiptId
    );

    res.json({
      success: true,
      message: 'Expense added to finance batch successfully',
      batch,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/finance-batches/:id/items/:receiptId
 * Remove an expense from an open finance batch.
 */
async function removeExpenseFromBatch(req, res, next) {
  try {
    const tenantId = req.user.tenantId;
    const userId = req.user.id;
    const userRole = req.user.role;
    const batchId = req.params.id;
    const receiptId = req.params.receiptId;

    const batch = await financeBatchService.removeExpenseFromBatch(
      tenantId,
      userId,
      userRole,
      batchId,
      receiptId
    );

    res.json({
      success: true,
      message: 'Expense removed from finance batch successfully',
      batch,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/finance-batches/:id/review
 * Complete finance review of a batch, transitioning status to REVIEWED.
 */
async function reviewBatch(req, res, next) {
  try {
    const tenantId = req.user.tenantId;
    const userId = req.user.id;
    const userRole = req.user.role;
    const batchId = req.params.id;

    const batch = await financeBatchService.reviewBatch(tenantId, userId, userRole, batchId);

    res.json({
      success: true,
      message: 'Finance batch reviewed successfully',
      batch,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getEligibleApprovedExpenses,
  getBatches,
  getBatchById,
  createBatch,
  addExpenseToBatch,
  removeExpenseFromBatch,
  reviewBatch,
};
