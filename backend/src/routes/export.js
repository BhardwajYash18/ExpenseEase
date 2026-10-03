const express = require('express');
const authenticate = require('../middleware/authenticate');
const requireRole = require('../middleware/requireRole');
const exportController = require('../controllers/exportController');
const { validateUuidParam } = require('../utils/validationUtils');

const router = express.Router();

// Parameter validation
router.param('id', validateUuidParam('id'));

// All export and integration operations require authentication and the FINANCE role
// per AGENTS.md Section 13, 20 and docs/PRD.md Section 9.3, FR-11.
router.use(authenticate);
router.use(requireRole('FINANCE'));

// CSV Exports
// GET /api/export/csv - General CSV export (?journalEntryId=... or ?batchId=... or all finalized)
router.get('/csv', exportController.exportCsv);

// GET /api/export/journal-entries/:id/csv - Single finalized journal entry CSV
router.get('/journal-entries/:id/csv', exportController.exportJournalEntryCsv);

// GET /api/export/finance-batches/:id/csv - Finance Batch finalized journal entry CSV
router.get('/finance-batches/:id/csv', exportController.exportFinanceBatchCsv);

// Accounting Integrations
// GET /api/export/integrations - List available integration providers and status
router.get('/integrations', exportController.getIntegrationProviders);

// POST /api/export/integrations/quickbooks/:id - Transform finalized journal entry for QuickBooks
router.post('/integrations/quickbooks/:id', exportController.executeQuickBooksIntegration);

// POST /api/export/integrations/xero/:id - Transform finalized journal entry for Xero
router.post('/integrations/xero/:id', exportController.executeXeroIntegration);

// Audit History
// GET /api/export/audit-logs - List export audit logs
router.get('/audit-logs', exportController.getExportAuditLogs);

module.exports = router;
