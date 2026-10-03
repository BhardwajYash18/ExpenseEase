const journalEntryService = require('../services/journalEntryService');
const { isValidUuid } = require('../utils/validationUtils');

/**
 * Journal Entry Controller (Checkpoint 8)
 *
 * REST API handlers for Journal Entries and deterministic double-entry accounting.
 * Strictly restricted to authenticated FINANCE role.
 */

async function listJournalEntries(req, res, next) {
  try {
    const tenantId = req.user.tenantId;
    const entries = await journalEntryService.getJournalEntries(tenantId);

    res.json({
      success: true,
      journalEntries: entries,
    });
  } catch (err) {
    next(err);
  }
}

async function getJournalEntry(req, res, next) {
  try {
    const tenantId = req.user.tenantId;
    const entryId = req.params.id;

    const entry = await journalEntryService.getJournalEntryById(tenantId, entryId);

    res.json({
      success: true,
      journalEntry: entry,
    });
  } catch (err) {
    next(err);
  }
}

async function getJournalEntryByBatch(req, res, next) {
  try {
    const tenantId = req.user.tenantId;
    const batchId = req.params.batchId;

    const entry = await journalEntryService.getJournalEntryByBatchId(tenantId, batchId);

    if (!entry) {
      return res.status(404).json({
        success: false,
        error: { message: 'No journal entry found for this Finance Batch' },
      });
    }

    res.json({
      success: true,
      journalEntry: entry,
    });
  } catch (err) {
    next(err);
  }
}

async function generateJournalEntry(req, res, next) {
  try {
    const tenantId = req.user.tenantId;
    const userId = req.user.id;
    const userRole = req.user.role;

    // batchId can be passed in URL params or request body
    const batchId = req.params.batchId || req.body.batchId;

    if (!batchId) {
      return res.status(400).json({
        success: false,
        error: { message: 'batchId is required to generate a journal entry' },
      });
    }

    if (!isValidUuid(batchId)) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid batchId format: must be a valid UUID' },
      });
    }

    const entry = await journalEntryService.generateJournalEntry(
      tenantId,
      userId,
      userRole,
      batchId
    );

    res.status(201).json({
      success: true,
      journalEntry: entry,
    });
  } catch (err) {
    next(err);
  }
}

async function finalizeJournalEntry(req, res, next) {
  try {
    const tenantId = req.user.tenantId;
    const userId = req.user.id;
    const userRole = req.user.role;
    const entryId = req.params.id;

    const entry = await journalEntryService.finalizeJournalEntry(
      tenantId,
      userId,
      userRole,
      entryId
    );

    res.status(200).json({
      success: true,
      journalEntry: entry,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listJournalEntries,
  getJournalEntry,
  getJournalEntryByBatch,
  generateJournalEntry,
  finalizeJournalEntry,
};
