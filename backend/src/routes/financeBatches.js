const express = require('express');
const authenticate = require('../middleware/authenticate');
const requireRole = require('../middleware/requireRole');
const financeBatchController = require('../controllers/financeBatchController');

const router = express.Router();

// All finance batch operations require authentication and the FINANCE role
// per AGENTS.md Section 13 and docs/PRD.md Section 9.3.
router.use(authenticate);
router.use(requireRole('FINANCE'));

// GET /api/finance-batches/eligible-expenses - List approved expenses available for batching
router.get('/eligible-expenses', financeBatchController.getEligibleApprovedExpenses);

// GET /api/finance-batches - List all finance batches for tenant
router.get('/', financeBatchController.getBatches);

// POST /api/finance-batches - Create a new finance batch grouping approved expenses
router.post('/', financeBatchController.createBatch);

// GET /api/finance-batches/:id - Get detailed finance batch information
router.get('/:id', financeBatchController.getBatchById);

// POST /api/finance-batches/:id/items - Add an approved expense to an open batch
router.post('/:id/items', financeBatchController.addExpenseToBatch);

// DELETE /api/finance-batches/:id/items/:receiptId - Remove an expense from an open batch
router.delete('/:id/items/:receiptId', financeBatchController.removeExpenseFromBatch);

// POST /api/finance-batches/:id/review - Complete finance review on a batch
router.post('/:id/review', financeBatchController.reviewBatch);

module.exports = router;
