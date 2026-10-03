const { withTenantContext } = require('../config/db');
const { parseToCents } = require('./policy/decimalUtils');

/**
 * Journal Entry Service (Checkpoint 8)
 *
 * Implements deterministic double-entry accounting journal entries generated
 * from reviewed Finance Batches, strictly adhering to AGENTS.md (Sections 6, 12, 13, 14, 15, 16, 17, 28)
 * and docs/PRD.md (Sections 5 [FR-10, FR-12], 8, 12.2, 12.3, 16.1).
 *
 * Traceability & Implementation Choices:
 * 1. Finance Batch is the Source (AUTHORITATIVE REQUIREMENT):
 *    Journal entries are generated exclusively from Finance Batches that have completed Finance Review
 *    (AGENTS.md Sec 6, 14, 28; PRD FR-10.1).
 * 2. Deterministic Account Mapping (AUTHORITATIVE REQUIREMENT):
 *    Expense Category → Configured Account Mapping → Accounting Account → Journal Entry Line (AGENTS.md Sec 15; PRD FR-10.2).
 *    AI/LLM does NOT invent accounting accounts or decide debit/credit balances (AGENTS.md Sec 7, 15; PRD FR-10.3).
 *    Missing account mappings result in an explicit error (AGENTS.md Sec 15; PRD FR-10.6).
 * 3. Double-Entry Integrity (AUTHORITATIVE REQUIREMENT):
 *    Every finalized journal entry must satisfy TOTAL DEBITS = TOTAL CREDITS (AGENTS.md Sec 15; PRD FR-10.4).
 *    Unbalanced journal entries must not be finalized (AGENTS.md Sec 15; PRD FR-10.5).
 * 4. Deterministic Arithmetic (AUTHORITATIVE REQUIREMENT):
 *    All totals and lines calculated via integer cents using parseToCents with zero floating-point arithmetic (AGENTS.md Sec 16; PRD Sec 12.3).
 * 5. Journal Entry Status (IMPLEMENTATION CHOICE):
 *    Journal entries are reviewable before finalization (AGENTS.md Sec 15, 28; PRD FR-10.7).
 *    - 'DRAFT': generated, reviewable, pending finalization
 *    - 'FINALIZED': balance validated, finalized by Finance
 * 6. Auditability (AUTHORITATIVE REQUIREMENT):
 *    Append-only audit trail in journal_entry_actions capturing WHO, WHAT, WHEN, WHICH RESOURCE (AGENTS.md Sec 17; PRD FR-12.2, FR-12.3).
 * 7. Multi-Tenancy & Authorization (AUTHORITATIVE REQUIREMENT):
 *    PostgreSQL RLS enforced on all tables; restricted to authenticated FINANCE role (AGENTS.md Sec 12, 13).
 */

const JOURNAL_STATUSES = {
  DRAFT: 'DRAFT',
  FINALIZED: 'FINALIZED',
};

const JOURNAL_ACTIONS = {
  GENERATE: 'GENERATE',
  FINALIZE: 'FINALIZE',
};

/**
 * Helper to compute effective receipt values.
 */
function computeReceiptEffectiveValues(row) {
  const effectiveAmount = row.confirmed_total_amount !== null && row.confirmed_total_amount !== undefined
    ? Number(row.confirmed_total_amount)
    : (row.ai_total_amount !== null && row.ai_total_amount !== undefined ? Number(row.ai_total_amount) : null);

  const effectiveMerchant = row.confirmed_merchant_name || row.ai_merchant_name || 'Unknown Merchant';
  const effectiveDate = row.confirmed_receipt_date || row.ai_receipt_date || null;
  const effectiveCategory = row.confirmed_category || row.ai_suggested_category || 'Uncategorized';

  return {
    effectiveAmount,
    effectiveMerchant,
    effectiveDate,
    effectiveCategory,
  };
}

/**
 * Format journal entry row for API responses.
 */
function formatJournalEntry(row, lines = [], auditHistory = []) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    batchId: row.batch_id,
    status: row.status,
    totalDebit: Number(row.total_debit),
    totalCredit: Number(row.total_credit),
    lineCount: row.line_count,
    isBalanced: Number(row.total_debit) === Number(row.total_credit) && Number(row.total_debit) > 0,
    createdBy: {
      id: row.created_by,
      name: row.creator_name || null,
      email: row.creator_email || null,
    },
    finalizedBy: row.finalized_by
      ? {
          id: row.finalized_by,
          name: row.finalizer_name || null,
          email: row.finalizer_email || null,
        }
      : null,
    finalizedAt: row.finalized_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lines: lines.map((l) => ({
      id: l.id,
      lineOrder: l.line_order,
      receiptId: l.receipt_id || null,
      account: l.account,
      debitAmount: Number(l.debit_amount),
      creditAmount: Number(l.credit_amount),
      description: l.description || null,
      createdAt: l.created_at,
    })),
    auditHistory: auditHistory.map((a) => ({
      id: a.id,
      action: a.action,
      actorId: a.actor_id,
      actorRole: a.actor_role,
      actorName: a.actor_name || null,
      details: a.details,
      createdAt: a.created_at,
    })),
  };
}

/**
 * Get all journal entries for the tenant.
 *
 * @param {string} tenantId - Tenant UUID
 * @returns {Promise<Array>} List of journal entries
 */
async function getJournalEntries(tenantId) {
  return withTenantContext(tenantId, async (client) => {
    const query = `
      SELECT je.*,
             CONCAT(cu.first_name, ' ', cu.last_name) as creator_name, cu.email as creator_email,
             CONCAT(fu.first_name, ' ', fu.last_name) as finalizer_name, fu.email as finalizer_email
      FROM journal_entries je
      JOIN users cu ON je.created_by = cu.id
      LEFT JOIN users fu ON je.finalized_by = fu.id
      ORDER BY je.created_at DESC
    `;

    const { rows } = await client.query(query);
    return rows.map((r) => formatJournalEntry(r));
  });
}

/**
 * Get journal entry details by ID including lines and audit history.
 *
 * @param {string} tenantId - Tenant UUID
 * @param {string} entryId - Journal entry UUID
 * @returns {Promise<object>} Journal entry object
 */
async function getJournalEntryById(tenantId, entryId) {
  return withTenantContext(tenantId, async (client) => {
    const entryQuery = `
      SELECT je.*,
             CONCAT(cu.first_name, ' ', cu.last_name) as creator_name, cu.email as creator_email,
             CONCAT(fu.first_name, ' ', fu.last_name) as finalizer_name, fu.email as finalizer_email
      FROM journal_entries je
      JOIN users cu ON je.created_by = cu.id
      LEFT JOIN users fu ON je.finalized_by = fu.id
      WHERE je.id = $1
    `;

    const { rows: entryRows } = await client.query(entryQuery, [entryId]);
    if (!entryRows[0]) {
      const error = new Error('Journal entry not found');
      error.status = 404;
      throw error;
    }

    const linesQuery = `
      SELECT * FROM journal_entry_lines
      WHERE journal_entry_id = $1
      ORDER BY line_order ASC, created_at ASC
    `;
    const { rows: lineRows } = await client.query(linesQuery, [entryId]);

    const auditQuery = `
      SELECT a.*, CONCAT(u.first_name, ' ', u.last_name) as actor_name
      FROM journal_entry_actions a
      JOIN users u ON a.actor_id = u.id
      WHERE a.journal_entry_id = $1
      ORDER BY a.created_at ASC
    `;
    const { rows: auditRows } = await client.query(auditQuery, [entryId]);

    return formatJournalEntry(entryRows[0], lineRows, auditRows);
  });
}

/**
 * Get journal entry associated with a specific Finance Batch.
 *
 * @param {string} tenantId - Tenant UUID
 * @param {string} batchId - Finance Batch UUID
 * @returns {Promise<object|null>} Journal entry or null
 */
async function getJournalEntryByBatchId(tenantId, batchId) {
  return withTenantContext(tenantId, async (client) => {
    const { rows } = await client.query(
      'SELECT id FROM journal_entries WHERE batch_id = $1',
      [batchId]
    );

    if (!rows[0]) return null;
    return getJournalEntryById(tenantId, rows[0].id);
  });
}

/**
 * Generate a new Journal Entry from a reviewed Finance Batch.
 *
 * Enforces:
 * - Finance role only
 * - Batch exists, belongs to tenant, and is in 'REVIEWED' status (AGENTS.md Sec 6, 14, 28)
 * - Prevents duplicate journal entries for the same batch (AGENTS.md Sec 23)
 * - Deterministic account mappings for every expense category (PRD FR-10.2, AGENTS.md Sec 15)
 * - Exact integer-cent double-entry line calculation (AGENTS.md Sec 16)
 * - Atomic all-or-nothing transactional creation
 *
 * @param {string} tenantId - Tenant UUID
 * @param {string} userId - User UUID (Finance)
 * @param {string} userRole - User role ('FINANCE')
 * @param {string} batchId - Finance Batch UUID
 * @returns {Promise<object>} Created journal entry
 */
async function generateJournalEntry(tenantId, userId, userRole, batchId) {
  if (userRole !== 'FINANCE') {
    const error = new Error('Forbidden: Only FINANCE role can generate journal entries');
    error.status = 403;
    throw error;
  }

  return withTenantContext(tenantId, async (client) => {
    await client.query('BEGIN');

    try {
      // 1. Lock and inspect Finance Batch
      const batchQuery = `
        SELECT id, tenant_id, status, total_amount, expense_count
        FROM finance_batches
        WHERE id = $1
        FOR UPDATE
      `;
      const { rows: batchRows } = await client.query(batchQuery, [batchId]);

      if (!batchRows[0]) {
        const error = new Error('Finance batch not found');
        error.status = 404;
        throw error;
      }

      const batch = batchRows[0];

      // Batch MUST be in 'REVIEWED' status (AGENTS.md Sec 6, 14, 28; PRD Sec 8)
      if (batch.status !== 'REVIEWED') {
        const error = new Error(
          `Cannot generate journal entry: Finance Batch status is '${batch.status}'. A batch must complete Finance Review before generating journal entries.`
        );
        error.status = 400;
        throw error;
      }

      // 2. Duplicate generation check (AGENTS.md Sec 23)
      const existingQuery = `
        SELECT id FROM journal_entries WHERE batch_id = $1
      `;
      const { rows: existingRows } = await client.query(existingQuery, [batchId]);
      if (existingRows.length > 0) {
        const error = new Error(
          `Validation failed: A journal entry already exists for Finance Batch ${batchId}`
        );
        error.status = 400;
        throw error;
      }

      // 3. Retrieve batch items with receipt extractions and workflow state
      const itemsQuery = `
        SELECT bi.id as item_id, bi.receipt_id, bi.amount as item_amount,
               r.original_filename,
               re.ai_suggested_category, re.confirmed_category,
               re.ai_total_amount, re.confirmed_total_amount,
               re.ai_merchant_name, re.confirmed_merchant_name,
               ew.current_state as workflow_state
        FROM finance_batch_items bi
        JOIN receipts r ON bi.receipt_id = r.id
        JOIN expense_workflows ew ON bi.receipt_id = ew.receipt_id
        LEFT JOIN receipt_extractions re ON bi.receipt_id = re.receipt_id
        WHERE bi.batch_id = $1
        ORDER BY bi.created_at ASC
      `;
      const { rows: itemRows } = await client.query(itemsQuery, [batchId]);

      if (itemRows.length === 0) {
        const error = new Error('Cannot generate journal entry for an empty Finance Batch');
        error.status = 400;
        throw error;
      }

      // Verify all items are strictly APPROVED (defense in depth)
      const unapproved = itemRows.filter((item) => item.workflow_state !== 'APPROVED');
      if (unapproved.length > 0) {
        const error = new Error(
          `Validation failed: Batch contains items not in APPROVED state: ${unapproved.map((i) => i.receipt_id).join(', ')}`
        );
        error.status = 400;
        throw error;
      }

      // 4. Retrieve account mappings for the tenant
      const mappingsQuery = `
        SELECT * FROM account_mappings WHERE tenant_id = $1
      `;
      const { rows: mappingRows } = await client.query(mappingsQuery, [tenantId]);
      const mappingMap = new Map();
      for (const m of mappingRows) {
        mappingMap.set(m.category.trim().toLowerCase(), m);
      }

      // 5. Generate deterministic journal entry lines
      let totalDebitCents = 0;
      let totalCreditCents = 0;
      const linesToInsert = [];
      let currentOrder = 1;

      for (const item of itemRows) {
        const eff = computeReceiptEffectiveValues(item);
        const categoryKey = eff.effectiveCategory.trim().toLowerCase();
        const mapping = mappingMap.get(categoryKey);

        if (!mapping) {
          const error = new Error(
            `Missing account mapping for category: '${eff.effectiveCategory}'. Configure account mapping for this category before generating journal entries.`
          );
          error.status = 400;
          throw error;
        }

        const parsedAmount = parseToCents(item.item_amount);
        if (!parsedAmount.valid || parsedAmount.cents <= 0) {
          const error = new Error(
            `Validation failed: Invalid monetary amount for receipt ${item.receipt_id}: ${item.item_amount}`
          );
          error.status = 400;
          throw error;
        }

        const cents = parsedAmount.cents;
        const formattedAmount = parsedAmount.formatted;

        // Debit Line (Expense Account)
        linesToInsert.push({
          lineOrder: currentOrder++,
          receiptId: item.receipt_id,
          account: mapping.debit_account,
          debitAmount: formattedAmount,
          creditAmount: '0.00',
          description: `Expense: ${eff.effectiveMerchant} (${eff.effectiveCategory})`,
        });
        totalDebitCents += cents;

        // Credit Line (Payable / Liability Account)
        linesToInsert.push({
          lineOrder: currentOrder++,
          receiptId: item.receipt_id,
          account: mapping.credit_account,
          debitAmount: '0.00',
          creditAmount: formattedAmount,
          description: `Payable: ${eff.effectiveMerchant} (${eff.effectiveCategory})`,
        });
        totalCreditCents += cents;
      }

      // 6. Double-entry validation on generated amounts
      if (totalDebitCents !== totalCreditCents || totalDebitCents <= 0) {
        const error = new Error(
          `Double-entry imbalance detected: Debits (${totalDebitCents} cents) != Credits (${totalCreditCents} cents)`
        );
        error.status = 400;
        throw error;
      }

      const totalDebitFormatted = (totalDebitCents / 100).toFixed(2);
      const totalCreditFormatted = (totalCreditCents / 100).toFixed(2);
      const lineCount = linesToInsert.length;

      // 7. Insert journal entry
      const insertEntryQuery = `
        INSERT INTO journal_entries (
          tenant_id, batch_id, created_by, status,
          total_debit, total_credit, line_count
        )
        VALUES ($1, $2, $3, 'DRAFT', $4, $5, $6)
        RETURNING *
      `;
      const { rows: entryInsertRows } = await client.query(insertEntryQuery, [
        tenantId,
        batchId,
        userId,
        totalDebitFormatted,
        totalCreditFormatted,
        lineCount,
      ]);
      const newEntry = entryInsertRows[0];

      // 8. Insert journal entry lines
      for (const line of linesToInsert) {
        const insertLineQuery = `
          INSERT INTO journal_entry_lines (
            journal_entry_id, tenant_id, receipt_id, line_order,
            account, debit_amount, credit_amount, description
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `;
        await client.query(insertLineQuery, [
          newEntry.id,
          tenantId,
          line.receiptId,
          line.lineOrder,
          line.account,
          line.debitAmount,
          line.creditAmount,
          line.description,
        ]);
      }

      // 9. Record audit trail
      const insertAuditQuery = `
        INSERT INTO journal_entry_actions (
          journal_entry_id, tenant_id, actor_id, actor_role, action, details
        )
        VALUES ($1, $2, $3, $4, 'GENERATE', $5)
      `;
      await client.query(insertAuditQuery, [
        newEntry.id,
        tenantId,
        userId,
        userRole,
        `Generated journal entry with ${lineCount} line(s) from Finance Batch ${batchId}. Total: $${totalDebitFormatted}`,
      ]);

      await client.query('COMMIT');
      return getJournalEntryById(tenantId, newEntry.id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

/**
 * Finalize a journal entry.
 *
 * Verifies:
 * - Finance role only
 * - Journal entry exists, belongs to tenant, and is in 'DRAFT' status
 * - Associated Finance Batch is in 'REVIEWED' status
 * - Exact double-entry balance check: TOTAL DEBITS = TOTAL CREDITS (AGENTS.md Sec 15; PRD FR-10.4, FR-10.5)
 * - Atomic transactional finalization
 *
 * @param {string} tenantId - Tenant UUID
 * @param {string} userId - User UUID (Finance)
 * @param {string} userRole - User role ('FINANCE')
 * @param {string} entryId - Journal entry UUID
 * @returns {Promise<object>} Finalized journal entry
 */
async function finalizeJournalEntry(tenantId, userId, userRole, entryId) {
  if (userRole !== 'FINANCE') {
    const error = new Error('Forbidden: Only FINANCE role can finalize journal entries');
    error.status = 403;
    throw error;
  }

  return withTenantContext(tenantId, async (client) => {
    await client.query('BEGIN');

    try {
      // 1. Lock and inspect journal entry
      const entryQuery = `
        SELECT je.*, fb.status as batch_status
        FROM journal_entries je
        JOIN finance_batches fb ON je.batch_id = fb.id
        WHERE je.id = $1
        FOR UPDATE OF je
      `;
      const { rows: entryRows } = await client.query(entryQuery, [entryId]);

      if (!entryRows[0]) {
        const error = new Error('Journal entry not found');
        error.status = 404;
        throw error;
      }

      const entry = entryRows[0];

      if (entry.status === JOURNAL_STATUSES.FINALIZED) {
        const error = new Error('Validation failed: Journal entry has already been finalized');
        error.status = 400;
        throw error;
      }

      if (entry.status !== JOURNAL_STATUSES.DRAFT) {
        const error = new Error(`Validation failed: Cannot finalize journal entry with status '${entry.status}'`);
        error.status = 400;
        throw error;
      }

      if (entry.batch_status !== 'REVIEWED') {
        const error = new Error('Validation failed: Associated Finance Batch must be in REVIEWED status');
        error.status = 400;
        throw error;
      }

      // 2. Fetch and strictly validate all journal lines for double-entry balance
      const linesQuery = `
        SELECT * FROM journal_entry_lines
        WHERE journal_entry_id = $1
        ORDER BY line_order ASC
        FOR UPDATE
      `;
      const { rows: lines } = await client.query(linesQuery, [entryId]);

      if (lines.length === 0) {
        const error = new Error('Validation failed: Journal entry has no lines');
        error.status = 400;
        throw error;
      }

      let sumDebitsCents = 0;
      let sumCreditsCents = 0;

      for (const line of lines) {
        const pDebit = parseToCents(line.debit_amount);
        const pCredit = parseToCents(line.credit_amount);

        if (!pDebit.valid || !pCredit.valid) {
          const error = new Error(`Validation failed: Invalid monetary amount in line ${line.id}`);
          error.status = 400;
          throw error;
        }

        sumDebitsCents += pDebit.cents;
        sumCreditsCents += pCredit.cents;
      }

      // Double-entry validation: TOTAL DEBITS = TOTAL CREDITS (AGENTS.md Sec 15; PRD FR-10.4, FR-10.5)
      if (sumDebitsCents !== sumCreditsCents || sumDebitsCents <= 0) {
        const debitStr = (sumDebitsCents / 100).toFixed(2);
        const creditStr = (sumCreditsCents / 100).toFixed(2);
        const error = new Error(
          `Double-entry validation failed: Total debits ($${debitStr}) must equal total credits ($${creditStr}). Unbalanced journal entries cannot be finalized.`
        );
        error.status = 400;
        throw error;
      }

      const totalDebitFormatted = (sumDebitsCents / 100).toFixed(2);
      const totalCreditFormatted = (sumCreditsCents / 100).toFixed(2);

      // 3. Update entry to FINALIZED
      const updateQuery = `
        UPDATE journal_entries
        SET status = 'FINALIZED',
            finalized_by = $1,
            finalized_at = CURRENT_TIMESTAMP,
            total_debit = $2,
            total_credit = $3,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $4
        RETURNING *
      `;
      await client.query(updateQuery, [
        userId,
        totalDebitFormatted,
        totalCreditFormatted,
        entryId,
      ]);

      // 4. Record audit trail
      const auditQuery = `
        INSERT INTO journal_entry_actions (
          journal_entry_id, tenant_id, actor_id, actor_role, action, details
        )
        VALUES ($1, $2, $3, $4, 'FINALIZE', $5)
      `;
      await client.query(auditQuery, [
        entryId,
        tenantId,
        userId,
        userRole,
        `Finalized journal entry. Total debits: $${totalDebitFormatted}, Total credits: $${totalCreditFormatted}`,
      ]);

      await client.query('COMMIT');
      return getJournalEntryById(tenantId, entryId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

module.exports = {
  JOURNAL_STATUSES,
  JOURNAL_ACTIONS,
  getJournalEntries,
  getJournalEntryById,
  getJournalEntryByBatchId,
  generateJournalEntry,
  finalizeJournalEntry,
};
