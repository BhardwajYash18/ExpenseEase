const csvExportService = require('../services/csvExportService');
const integrationService = require('../services/integrations/integrationService');
const { isValidUuid } = require('../utils/validationUtils');

/**
 * Export & Integration Controller (Checkpoint 9)
 *
 * Implements REST handlers for CSV export and accounting integrations
 * (AGENTS.md Sec 13, 14, 15, 18, 20, 28; docs/PRD.md FR-11, FR-12, Sec 15.1).
 */

/**
 * Export a single finalized Journal Entry as CSV.
 * GET /api/export/journal-entries/:id/csv
 */
async function exportJournalEntryCsv(req, res, next) {
  try {
    const { id } = req.params;
    const result = await csvExportService.exportJournalEntryCsv(
      req.user.tenantId,
      req.user.id,
      req.user.role,
      id
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return res.status(200).send(result.csvContent);
  } catch (err) {
    next(err);
  }
}

/**
 * Export a Finance Batch's finalized Journal Entry as CSV.
 * GET /api/export/finance-batches/:id/csv
 */
async function exportFinanceBatchCsv(req, res, next) {
  try {
    const { id } = req.params;
    const result = await csvExportService.exportFinanceBatchCsv(
      req.user.tenantId,
      req.user.id,
      req.user.role,
      id
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return res.status(200).send(result.csvContent);
  } catch (err) {
    next(err);
  }
}

/**
 * General CSV export endpoint.
 * Supports:
 * - ?journalEntryId=... -> single journal entry CSV
 * - ?batchId=... -> batch journal entry CSV
 * - (no query params) -> all finalized journal entries for tenant
 * GET /api/export/csv
 */
async function exportCsv(req, res, next) {
  try {
    const { journalEntryId, batchId } = req.query;

    if (journalEntryId && !isValidUuid(journalEntryId)) {
      return res.status(400).json({ error: { message: 'Invalid query parameter: journalEntryId must be a valid UUID' } });
    }
    if (batchId && !isValidUuid(batchId)) {
      return res.status(400).json({ error: { message: 'Invalid query parameter: batchId must be a valid UUID' } });
    }

    let result;
    if (journalEntryId) {
      result = await csvExportService.exportJournalEntryCsv(
        req.user.tenantId,
        req.user.id,
        req.user.role,
        journalEntryId
      );
    } else if (batchId) {
      result = await csvExportService.exportFinanceBatchCsv(
        req.user.tenantId,
        req.user.id,
        req.user.role,
        batchId
      );
    } else {
      result = await csvExportService.exportAllFinalizedCsv(
        req.user.tenantId,
        req.user.id,
        req.user.role
      );
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return res.status(200).send(result.csvContent);
  } catch (err) {
    next(err);
  }
}

/**
 * Get available integration providers and status.
 * GET /api/export/integrations
 */
async function getIntegrationProviders(req, res, next) {
  try {
    const providers = integrationService.getAvailableProviders();
    return res.status(200).json({
      success: true,
      providers,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Execute QuickBooks integration for a finalized journal entry.
 * POST /api/export/integrations/quickbooks/:id
 */
async function executeQuickBooksIntegration(req, res, next) {
  try {
    const { id } = req.params;
    const result = await integrationService.executeIntegration(
      req.user.tenantId,
      req.user.id,
      req.user.role,
      'quickbooks',
      id
    );

    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * Execute Xero integration for a finalized journal entry.
 * POST /api/export/integrations/xero/:id
 */
async function executeXeroIntegration(req, res, next) {
  try {
    const { id } = req.params;
    const result = await integrationService.executeIntegration(
      req.user.tenantId,
      req.user.id,
      req.user.role,
      'xero',
      id
    );

    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * Get export audit log history.
 * GET /api/export/audit-logs
 */
async function getExportAuditLogs(req, res, next) {
  try {
    const logs = await csvExportService.getExportAuditLogs(req.user.tenantId);
    return res.status(200).json({
      success: true,
      auditLogs: logs,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  exportJournalEntryCsv,
  exportFinanceBatchCsv,
  exportCsv,
  getIntegrationProviders,
  executeQuickBooksIntegration,
  executeXeroIntegration,
  getExportAuditLogs,
};
