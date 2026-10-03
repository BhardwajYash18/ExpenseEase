const { withTenantContext } = require('../config/db');
const journalEntryService = require('./journalEntryService');

/**
 * CSV Export Service (Checkpoint 9)
 *
 * Implements deterministic, RFC 4180 compliant CSV export for finalized
 * accounting records adhering strictly to AGENTS.md (Sections 6, 12, 13, 14, 15, 16, 17, 28)
 * and docs/PRD.md (FR-11.1, FR-12.2, FR-12.3; Section 8, 9.3).
 *
 * Security & Integrity Guarantees:
 * 1. Finalized Source Only: Strictly exports FINALIZED journal entries. Drafts are rejected with HTTP 400.
 * 2. Deterministic & Read-Only: Zero mutations to journal entries, lines, batches, or receipts.
 * 3. Formula Injection Protection: Prefixes formula trigger characters (=, +, -, @) on text fields with a single quote.
 * 4. Proper RFC 4180 Escaping: Correctly escapes commas, double quotes, and newlines.
 * 5. Full Auditability: Records append-only audit trail in export_audit_logs.
 * 6. PostgreSQL RLS & RBAC: Enforces tenant context isolation and FINANCE role restriction.
 */

// CSV Header Columns (Deterministic order)
const CSV_HEADERS = [
  'journal_entry_id',
  'finance_batch_id',
  'line_order',
  'account',
  'debit_amount',
  'credit_amount',
  'description',
  'receipt_id',
  'entry_date',
];

/**
 * Sanitize a string field to prevent CSV / Spreadsheet formula injection.
 * Formula triggers: '=', '+', '-', '@'
 *
 * @param {string} val - Input value
 * @returns {string} Sanitized value
 */
function sanitizeFormulaInjection(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (/^[=+\-@]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

/**
 * Escape a field for RFC 4180 CSV compliance.
 * Fields containing commas, double quotes, or newlines must be enclosed in quotes,
 * and internal double quotes doubled.
 *
 * @param {any} val - Value to escape
 * @param {boolean} checkFormula - Whether to apply formula injection protection
 * @returns {string} Escaped CSV cell value
 */
function escapeCsvCell(val, checkFormula = true) {
  if (val === null || val === undefined) return '';
  let str = checkFormula ? sanitizeFormulaInjection(val) : String(val);

  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Format a Journal Entry line into a CSV row.
 *
 * @param {object} line - Journal entry line
 * @param {object} entry - Parent journal entry metadata
 * @returns {string} CSV formatted row
 */
function formatCsvRow(line, entry) {
  const entryDate = entry.finalizedAt
    ? new Date(entry.finalizedAt).toISOString().split('T')[0]
    : (entry.createdAt ? new Date(entry.createdAt).toISOString().split('T')[0] : '');

  const row = [
    escapeCsvCell(entry.id, false),
    escapeCsvCell(entry.batchId, false),
    line.lineOrder || '',
    escapeCsvCell(line.account, true),
    Number(line.debitAmount || 0).toFixed(2),
    Number(line.creditAmount || 0).toFixed(2),
    escapeCsvCell(line.description || '', true),
    escapeCsvCell(line.receiptId || '', false),
    escapeCsvCell(entryDate, false),
  ];

  return row.join(',');
}

/**
 * Export a single finalized Journal Entry as CSV.
 *
 * @param {string} tenantId - Tenant UUID
 * @param {string} userId - User UUID (Finance)
 * @param {string} userRole - User role ('FINANCE')
 * @param {string} entryId - Journal entry UUID
 * @returns {Promise<{ filename: string, csvContent: string, recordCount: number }>}
 */
async function exportJournalEntryCsv(tenantId, userId, userRole, entryId) {
  if (userRole !== 'FINANCE') {
    const error = new Error('Forbidden: Only FINANCE role can export accounting CSV data');
    error.status = 403;
    throw error;
  }

  // 1. Fetch journal entry with lines using tenant context (enforces RLS)
  const entry = await journalEntryService.getJournalEntryById(tenantId, entryId);

  // 2. Enforce finalized eligibility
  if (entry.status !== 'FINALIZED') {
    const error = new Error(
      `Cannot export unfinalized journal entry to CSV. Status is '${entry.status}'. Finalize the journal entry before export.`
    );
    error.status = 400;
    throw error;
  }

  const lines = entry.lines || [];
  const rows = [CSV_HEADERS.join(',')];

  for (const line of lines) {
    rows.push(formatCsvRow(line, entry));
  }

  const csvContent = rows.join('\r\n') + '\r\n';
  const filename = `journal-entry-${entry.id.substring(0, 8)}.csv`;

  // 3. Record audit log
  await withTenantContext(tenantId, async (client) => {
    const auditQuery = `
      INSERT INTO export_audit_logs (
        tenant_id, actor_id, actor_role, export_type,
        resource_type, resource_id, record_count, details
      )
      VALUES ($1, $2, $3, 'CSV', 'JOURNAL_ENTRY', $4, $5, $6)
    `;
    await client.query(auditQuery, [
      tenantId,
      userId,
      userRole,
      entry.id,
      lines.length,
      `Exported finalized journal entry ${entry.id} (${lines.length} lines, total: $${entry.totalDebit.toFixed(2)}) as CSV`,
    ]);
  });

  return {
    filename,
    csvContent,
    recordCount: lines.length,
  };
}

/**
 * Export a Finance Batch's finalized Journal Entry as CSV.
 *
 * @param {string} tenantId - Tenant UUID
 * @param {string} userId - User UUID (Finance)
 * @param {string} userRole - User role ('FINANCE')
 * @param {string} batchId - Finance Batch UUID
 * @returns {Promise<{ filename: string, csvContent: string, recordCount: number }>}
 */
async function exportFinanceBatchCsv(tenantId, userId, userRole, batchId) {
  if (userRole !== 'FINANCE') {
    const error = new Error('Forbidden: Only FINANCE role can export accounting CSV data');
    error.status = 403;
    throw error;
  }

  // 1. Verify Finance Batch exists in tenant context (enforces RLS)
  await withTenantContext(tenantId, async (client) => {
    const { rows: batchRows } = await client.query(
      'SELECT id FROM finance_batches WHERE id = $1',
      [batchId]
    );
    if (!batchRows[0]) {
      const error = new Error('Finance Batch not found');
      error.status = 404;
      throw error;
    }
  });

  const entry = await journalEntryService.getJournalEntryByBatchId(tenantId, batchId);
  if (!entry) {
    const error = new Error(
      `No journal entry found for Finance Batch ${batchId}. Generate and finalize a journal entry before export.`
    );
    error.status = 400;
    throw error;
  }

  if (entry.status !== 'FINALIZED') {
    const error = new Error(
      `Cannot export unfinalized journal entry to CSV. Status is '${entry.status}'. Finalize the journal entry before export.`
    );
    error.status = 400;
    throw error;
  }

  const lines = entry.lines || [];
  const rows = [CSV_HEADERS.join(',')];

  for (const line of lines) {
    rows.push(formatCsvRow(line, entry));
  }

  const csvContent = rows.join('\r\n') + '\r\n';
  const filename = `finance-batch-${batchId.substring(0, 8)}-journal.csv`;

  // Record audit log
  await withTenantContext(tenantId, async (client) => {
    const auditQuery = `
      INSERT INTO export_audit_logs (
        tenant_id, actor_id, actor_role, export_type,
        resource_type, resource_id, record_count, details
      )
      VALUES ($1, $2, $3, 'CSV', 'FINANCE_BATCH', $4, $5, $6)
    `;
    await client.query(auditQuery, [
      tenantId,
      userId,
      userRole,
      batchId,
      lines.length,
      `Exported Finance Batch ${batchId} finalized journal entry ${entry.id} (${lines.length} lines) as CSV`,
    ]);
  });

  return {
    filename,
    csvContent,
    recordCount: lines.length,
  };
}

/**
 * Export all finalized Journal Entries for the tenant as CSV.
 *
 * @param {string} tenantId - Tenant UUID
 * @param {string} userId - User UUID (Finance)
 * @param {string} userRole - User role ('FINANCE')
 * @returns {Promise<{ filename: string, csvContent: string, recordCount: number }>}
 */
async function exportAllFinalizedCsv(tenantId, userId, userRole) {
  if (userRole !== 'FINANCE') {
    const error = new Error('Forbidden: Only FINANCE role can export accounting CSV data');
    error.status = 403;
    throw error;
  }

  return withTenantContext(tenantId, async (client) => {
    // Query all finalized journal entries with their lines ordered deterministically
    const query = `
      SELECT je.id as journal_entry_id, je.batch_id, je.finalized_at, je.created_at,
             jel.line_order, jel.account, jel.debit_amount, jel.credit_amount,
             jel.description, jel.receipt_id
      FROM journal_entries je
      JOIN journal_entry_lines jel ON je.id = jel.journal_entry_id
      WHERE je.status = 'FINALIZED'
      ORDER BY je.finalized_at DESC, je.created_at DESC, jel.line_order ASC
    `;

    const { rows: lineRows } = await client.query(query);

    const rows = [CSV_HEADERS.join(',')];
    for (const r of lineRows) {
      const entry = {
        id: r.journal_entry_id,
        batchId: r.batch_id,
        finalizedAt: r.finalized_at,
        createdAt: r.created_at,
      };
      const line = {
        lineOrder: r.line_order,
        account: r.account,
        debitAmount: r.debit_amount,
        creditAmount: r.credit_amount,
        description: r.description,
        receiptId: r.receipt_id,
      };
      rows.push(formatCsvRow(line, entry));
    }

    const csvContent = rows.join('\r\n') + '\r\n';
    const filename = `expensEase-journal-entries-${new Date().toISOString().split('T')[0]}.csv`;

    // Record audit log
    const auditQuery = `
      INSERT INTO export_audit_logs (
        tenant_id, actor_id, actor_role, export_type,
        resource_type, resource_id, record_count, details
      )
      VALUES ($1, $2, $3, 'CSV', 'ALL_JOURNAL_ENTRIES', NULL, $4, $5)
    `;
    await client.query(auditQuery, [
      tenantId,
      userId,
      userRole,
      lineRows.length,
      `Exported all finalized journal entries for tenant (${lineRows.length} lines total) as CSV`,
    ]);

    return {
      filename,
      csvContent,
      recordCount: lineRows.length,
    };
  });
}

/**
 * Get export audit log history for tenant.
 *
 * @param {string} tenantId - Tenant UUID
 * @returns {Promise<Array<object>>} Audit log history
 */
async function getExportAuditLogs(tenantId) {
  return withTenantContext(tenantId, async (client) => {
    const query = `
      SELECT eal.*, CONCAT(u.first_name, ' ', u.last_name) as actor_name, u.email as actor_email
      FROM export_audit_logs eal
      JOIN users u ON eal.actor_id = u.id
      ORDER BY eal.created_at DESC
      LIMIT 100
    `;
    const { rows } = await client.query(query);
    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      actorId: r.actor_id,
      actorName: r.actor_name,
      actorEmail: r.actor_email,
      actorRole: r.actor_role,
      exportType: r.export_type,
      resourceType: r.resource_type,
      resourceId: r.resource_id,
      recordCount: r.record_count,
      details: r.details,
      createdAt: r.created_at,
    }));
  });
}

module.exports = {
  CSV_HEADERS,
  sanitizeFormulaInjection,
  escapeCsvCell,
  exportJournalEntryCsv,
  exportFinanceBatchCsv,
  exportAllFinalizedCsv,
  getExportAuditLogs,
};
