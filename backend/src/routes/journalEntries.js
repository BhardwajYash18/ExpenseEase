const express = require('express');
const authenticate = require('../middleware/authenticate');
const requireRole = require('../middleware/requireRole');
const journalEntryController = require('../controllers/journalEntryController');

const router = express.Router();

// All journal entry operations require authentication and the FINANCE role
// per AGENTS.md Section 13, 15 and docs/PRD.md Section 9.3, FR-10.
router.use(authenticate);
router.use(requireRole('FINANCE'));

// GET /api/journal-entries - List all journal entries for tenant
router.get('/', journalEntryController.listJournalEntries);

// POST /api/journal-entries/generate - Generate a journal entry from a reviewed Finance Batch
router.post('/generate', journalEntryController.generateJournalEntry);

// GET /api/journal-entries/batch/:batchId - Get journal entry for a specific Finance Batch
router.get('/batch/:batchId', journalEntryController.getJournalEntryByBatch);

// GET /api/journal-entries/:id - Get detailed journal entry with lines and audit history
router.get('/:id', journalEntryController.getJournalEntry);

// POST /api/journal-entries/:id/finalize - Finalize a journal entry (validates TOTAL DEBITS = TOTAL CREDITS)
router.post('/:id/finalize', journalEntryController.finalizeJournalEntry);

module.exports = router;
