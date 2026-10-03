const { withTenantContext } = require('../config/db');
const { parseToCents } = require('./policy/decimalUtils');
const { isValidUuid } = require('../utils/validationUtils');

/**
 * Finance Batch Service (Checkpoint 7)
 *
 * Implements Finance Batches for grouping approved expenses for finance processing,
 * strictly adhering to AGENTS.md (Sections 6, 12, 13, 14, 16, 17, 28) and
 * docs/PRD.md (Sections 5 [FR-09, FR-12], 9.3, 12.1, 16.1).
 *
 * Traceability & Implementation Choices:
 * 1. Eligibility (AUTHORITATIVE REQUIREMENT):
 *    ONLY expenses with workflow state 'APPROVED' may enter a Finance Batch (PRD FR-09.2, AGENTS.md Sec 14).
 *    Unapproved, rejected, or cross-tenant expenses are strictly rejected.
 * 2. Duplicate Prevention (AUTHORITATIVE REQUIREMENT):
 *    The same expense must not be included multiple times within the same Finance Batch (PRD FR-09.3, AGENTS.md Sec 14).
 *    Enforced by database constraint UNIQUE(batch_id, receipt_id).
 *    No artificial cross-batch exclusivity rule is enforced; an approved expense can appear in separate batches.
 * 3. Batch Status (IMPLEMENTATION CHOICE):
 *    Batch status is required by AGENTS.md Sec 28 ("Batch status"), but the exact string literals
 *    'OPEN' and 'REVIEWED' are implementation representations of:
 *      - 'OPEN': batch created / open for Finance review
 *      - 'REVIEWED': finance review completed (locks batch from further item additions/removals)
 * 4. Transactional Semantics (API & DATA INTEGRITY BEHAVIOR):
 *    Finance Batch creation is transactional. If the submitted request is invalid (e.g., contains
 *    unapproved, cross-tenant, or duplicate items), the transaction rolls back rather than leaving
 *    a partially created batch.
 * 5. Batch Identifiers & Metadata:
 *    Batches are identified exclusively by their UUID (finance_batches.id).
 *    No invented batch_name or notes fields are persisted on finance_batches.
 * 6. Deterministic Totals (AUTHORITATIVE REQUIREMENT):
 *    Totals are calculated via integer cents using parseToCents with zero floating-point arithmetic (AGENTS.md Sec 16, PRD Sec 12.3).
 * 7. Expense Removal:
 *    Removing an expense from an OPEN batch leaves the expense strictly in 'APPROVED' workflow state.
 * 8. Auditability (AUTHORITATIVE REQUIREMENT):
 *    Append-only history in finance_batch_actions capturing WHO, WHAT, WHEN, WHICH RESOURCE (PRD FR-12.2, FR-12.3).
 */

const BATCH_STATUSES = {
  OPEN: 'OPEN',
  REVIEWED: 'REVIEWED',
};

const BATCH_ACTIONS = {
  CREATE: 'CREATE',
  ADD_ITEM: 'ADD_ITEM',
  REMOVE_ITEM: 'REMOVE_ITEM',
  REVIEW: 'REVIEW',
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
 * Get all eligible APPROVED expenses in the tenant.
 *
 * Per requirements, any expense in 'APPROVED' workflow state within the tenant is eligible.
 *
 * @param {string} tenantId - Authenticated tenant UUID
 * @returns {Promise<Array>} List of eligible approved expenses
 */
async function getEligibleApprovedExpenses(tenantId) {
  return withTenantContext(tenantId, async (client) => {
    const query = `
      SELECT r.id, r.original_filename, r.uploaded_by, r.created_at as receipt_created_at,
             CONCAT(u.first_name, ' ', u.last_name) as submitter_name, u.email as submitter_email,
             re.ai_total_amount, re.confirmed_total_amount,
             re.ai_merchant_name, re.confirmed_merchant_name,
             re.ai_receipt_date, re.confirmed_receipt_date,
             re.ai_suggested_category, re.confirmed_category,
             ew.current_state as workflow_state, ew.completed_at as approved_at
      FROM receipts r
      JOIN expense_workflows ew ON r.id = ew.receipt_id
      JOIN users u ON r.uploaded_by = u.id
      LEFT JOIN receipt_extractions re ON r.id = re.receipt_id
      WHERE ew.current_state = 'APPROVED'
      ORDER BY ew.completed_at DESC, r.created_at DESC
    `;

    const { rows } = await client.query(query);

    return rows.map((r) => {
      const eff = computeReceiptEffectiveValues(r);
      return {
        receiptId: r.id,
        filename: r.original_filename,
        submitter: {
          id: r.uploaded_by,
          name: r.submitter_name,
          email: r.submitter_email,
        },
        workflowState: r.workflow_state,
        approvedAt: r.approved_at,
        receiptCreatedAt: r.receipt_created_at,
        amount: eff.effectiveAmount,
        merchant: eff.effectiveMerchant,
        date: eff.effectiveDate,
        category: eff.effectiveCategory,
      };
    });
  });
}

/**
 * List all finance batches for the authenticated tenant.
 *
 * @param {string} tenantId - Authenticated tenant UUID
 * @returns {Promise<Array>} List of finance batches
 */
async function getBatches(tenantId) {
  return withTenantContext(tenantId, async (client) => {
    const query = `
      SELECT fb.id, fb.tenant_id, fb.status,
             fb.total_amount, fb.expense_count,
             fb.created_at, fb.updated_at,
             fb.reviewed_at,
             creator.id as creator_id, CONCAT(creator.first_name, ' ', creator.last_name) as creator_name, creator.email as creator_email,
             reviewer.id as reviewer_id, CONCAT(reviewer.first_name, ' ', reviewer.last_name) as reviewer_name, reviewer.email as reviewer_email
      FROM finance_batches fb
      JOIN users creator ON fb.created_by = creator.id
      LEFT JOIN users reviewer ON fb.reviewed_by = reviewer.id
      ORDER BY fb.created_at DESC
    `;

    const { rows } = await client.query(query);

    return rows.map((b) => ({
      id: b.id,
      tenantId: b.tenant_id,
      status: b.status,
      totalAmount: Number(b.total_amount),
      expenseCount: b.expense_count,
      createdAt: b.created_at,
      updatedAt: b.updated_at,
      createdBy: {
        id: b.creator_id,
        name: b.creator_name,
        email: b.creator_email,
      },
      reviewedBy: b.reviewer_id ? {
        id: b.reviewer_id,
        name: b.reviewer_name,
        email: b.reviewer_email,
      } : null,
      reviewedAt: b.reviewed_at,
    }));
  });
}

/**
 * Get detailed information for a single finance batch, including items and audit trail.
 *
 * @param {string} tenantId - Authenticated tenant UUID
 * @param {string} batchId - Batch UUID
 * @returns {Promise<object|null>} Detailed batch object or null if not found
 */
async function getBatchById(tenantId, batchId) {
  return withTenantContext(tenantId, async (client) => {
    // 1. Fetch batch metadata
    const batchQuery = `
      SELECT fb.id, fb.tenant_id, fb.status,
             fb.total_amount, fb.expense_count,
             fb.created_at, fb.updated_at,
             fb.reviewed_at,
             creator.id as creator_id, CONCAT(creator.first_name, ' ', creator.last_name) as creator_name, creator.email as creator_email,
             reviewer.id as reviewer_id, CONCAT(reviewer.first_name, ' ', reviewer.last_name) as reviewer_name, reviewer.email as reviewer_email
      FROM finance_batches fb
      JOIN users creator ON fb.created_by = creator.id
      LEFT JOIN users reviewer ON fb.reviewed_by = reviewer.id
      WHERE fb.id = $1
    `;

    const { rows: batchRows } = await client.query(batchQuery, [batchId]);
    if (!batchRows[0]) return null;

    const b = batchRows[0];

    // 2. Fetch items
    const itemsQuery = `
      SELECT fbi.id as item_id, fbi.batch_id, fbi.receipt_id, fbi.amount, fbi.created_at as item_created_at,
             r.original_filename, r.uploaded_by,
             CONCAT(u.first_name, ' ', u.last_name) as submitter_name, u.email as submitter_email,
             re.ai_merchant_name, re.confirmed_merchant_name,
             re.ai_receipt_date, re.confirmed_receipt_date,
             re.ai_suggested_category, re.confirmed_category,
             ew.current_state as workflow_state, ew.completed_at as approved_at
      FROM finance_batch_items fbi
      JOIN receipts r ON fbi.receipt_id = r.id
      JOIN users u ON r.uploaded_by = u.id
      LEFT JOIN receipt_extractions re ON r.id = re.receipt_id
      LEFT JOIN expense_workflows ew ON r.id = ew.receipt_id
      WHERE fbi.batch_id = $1
      ORDER BY fbi.created_at ASC
    `;

    const { rows: itemRows } = await client.query(itemsQuery, [batchId]);

    // 3. Fetch actions (audit trail)
    const actionsQuery = `
      SELECT fba.id, fba.batch_id, fba.actor_id, fba.actor_role,
             fba.action, fba.affected_receipt_id, fba.details, fba.created_at,
             CONCAT(u.first_name, ' ', u.last_name) as actor_name, u.email as actor_email
      FROM finance_batch_actions fba
      JOIN users u ON fba.actor_id = u.id
      WHERE fba.batch_id = $1
      ORDER BY fba.created_at ASC
    `;

    const { rows: actionRows } = await client.query(actionsQuery, [batchId]);

    return {
      id: b.id,
      tenantId: b.tenant_id,
      status: b.status,
      totalAmount: Number(b.total_amount),
      expenseCount: b.expense_count,
      createdAt: b.created_at,
      updatedAt: b.updated_at,
      createdBy: {
        id: b.creator_id,
        name: b.creator_name,
        email: b.creator_email,
      },
      reviewedBy: b.reviewer_id ? {
        id: b.reviewer_id,
        name: b.reviewer_name,
        email: b.reviewer_email,
      } : null,
      reviewedAt: b.reviewed_at,
      items: itemRows.map((item) => {
        const eff = computeReceiptEffectiveValues(item);
        return {
          id: item.item_id,
          receiptId: item.receipt_id,
          amount: Number(item.amount),
          filename: item.original_filename,
          submitter: {
            id: item.uploaded_by,
            name: item.submitter_name,
            email: item.submitter_email,
          },
          workflowState: item.workflow_state,
          approvedAt: item.approved_at,
          merchant: eff.effectiveMerchant,
          date: eff.effectiveDate,
          category: eff.effectiveCategory,
          addedAt: item.item_created_at,
        };
      }),
      auditHistory: actionRows.map((a) => ({
        id: a.id,
        action: a.action,
        actorId: a.actor_id,
        actorName: a.actor_name,
        actorRole: a.actor_role,
        affectedReceiptId: a.affected_receipt_id,
        details: a.details,
        createdAt: a.created_at,
      })),
    };
  });
}

/**
 * Create a new finance batch grouping approved expenses.
 *
 * Transactional semantics: If any requested receipt is unapproved, missing,
 * cross-tenant, or duplicated within the request, the transaction rolls back
 * rather than leaving a partially created batch.
 *
 * @param {string} tenantId - Authenticated tenant UUID
 * @param {string} userId - Authenticated user UUID (Finance)
 * @param {string} userRole - Authenticated user role (must be FINANCE)
 * @param {object} payload - { receiptIds }
 * @returns {Promise<object>} Created finance batch
 */
async function createBatch(tenantId, userId, userRole, { receiptIds }) {
  if (userRole !== 'FINANCE') {
    const error = new Error('Forbidden: Only FINANCE role can create finance batches');
    error.status = 403;
    throw error;
  }

  if (!Array.isArray(receiptIds) || receiptIds.length === 0) {
    const error = new Error('Validation failed: receiptIds must be a non-empty array of receipt IDs');
    error.status = 400;
    throw error;
  }

  for (const id of receiptIds) {
    if (!isValidUuid(id)) {
      const error = new Error(`Validation failed: Invalid receipt ID format: '${id}' is not a valid UUID`);
      error.status = 400;
      throw error;
    }
  }

  // Prevent duplicate inclusion of the same expense within the same batch (PRD FR-09.3)
  const uniqueReceiptIds = [...new Set(receiptIds)];
  if (uniqueReceiptIds.length !== receiptIds.length) {
    const error = new Error('Validation failed: Duplicate receipt IDs detected within batch creation request');
    error.status = 400;
    throw error;
  }

  return withTenantContext(tenantId, async (client) => {
    await client.query('BEGIN');

    try {
      // 1. Lock and retrieve candidate receipts within tenant
      const receiptQuery = `
        SELECT r.id, r.tenant_id, r.uploaded_by,
               re.ai_total_amount, re.confirmed_total_amount,
               ew.current_state as workflow_state
        FROM receipts r
        LEFT JOIN expense_workflows ew ON r.id = ew.receipt_id
        LEFT JOIN receipt_extractions re ON r.id = re.receipt_id
        WHERE r.id = ANY($1::uuid[])
        FOR UPDATE OF r
      `;

      const { rows: candidateRows } = await client.query(receiptQuery, [uniqueReceiptIds]);

      // Check if all requested receipts exist in tenant
      if (candidateRows.length !== uniqueReceiptIds.length) {
        const foundIds = new Set(candidateRows.map((r) => r.id));
        const missingIds = uniqueReceiptIds.filter((id) => !foundIds.has(id));
        const error = new Error(`Validation failed: Receipt(s) not found or cross-tenant: ${missingIds.join(', ')}`);
        error.status = 400;
        throw error;
      }

      // Check eligibility: MUST be 'APPROVED' (PRD FR-09.2, AGENTS.md Sec 14)
      const unapproved = candidateRows.filter((r) => r.workflow_state !== 'APPROVED');
      if (unapproved.length > 0) {
        const details = unapproved.map((r) => `${r.id} (state: ${r.workflow_state || 'UNSUBMITTED'})`).join(', ');
        const error = new Error(`Validation failed: Only APPROVED expenses may enter a finance batch. Ineligible expenses: ${details}`);
        error.status = 400;
        throw error;
      }

      // Calculate deterministic total amount using integer cents (AGENTS.md Sec 16)
      let totalCents = 0;
      const itemAmounts = [];

      for (const row of candidateRows) {
        const rawAmount = row.confirmed_total_amount !== null && row.confirmed_total_amount !== undefined
          ? row.confirmed_total_amount
          : row.ai_total_amount;

        const parsed = parseToCents(rawAmount);
        if (!parsed.valid || parsed.cents <= 0) {
          const error = new Error(`Validation failed: Receipt ${row.id} has invalid or non-positive monetary amount: ${rawAmount}`);
          error.status = 400;
          throw error;
        }

        totalCents += parsed.cents;
        itemAmounts.push({
          receiptId: row.id,
          amountFormatted: parsed.formatted,
        });
      }

      const totalAmountFormatted = (totalCents / 100).toFixed(2);
      const expenseCount = itemAmounts.length;

      // 2. Insert batch record
      const insertBatchQuery = `
        INSERT INTO finance_batches (
          tenant_id, created_by, status, total_amount, expense_count
        )
        VALUES ($1, $2, 'OPEN', $3, $4)
        RETURNING *
      `;

      const { rows: batchInsertRows } = await client.query(insertBatchQuery, [
        tenantId,
        userId,
        totalAmountFormatted,
        expenseCount,
      ]);

      const newBatch = batchInsertRows[0];

      // 3. Insert batch items
      for (const item of itemAmounts) {
        const insertItemQuery = `
          INSERT INTO finance_batch_items (batch_id, receipt_id, tenant_id, amount)
          VALUES ($1, $2, $3, $4)
        `;
        await client.query(insertItemQuery, [
          newBatch.id,
          item.receiptId,
          tenantId,
          item.amountFormatted,
        ]);
      }

      // 4. Record audit action
      const insertActionQuery = `
        INSERT INTO finance_batch_actions (
          batch_id, tenant_id, actor_id, actor_role,
          action, details
        )
        VALUES ($1, $2, $3, $4, 'CREATE', $5)
      `;
      await client.query(insertActionQuery, [
        newBatch.id,
        tenantId,
        userId,
        userRole,
        `Created finance batch with ${expenseCount} approved expense(s), total: $${totalAmountFormatted}`,
      ]);

      await client.query('COMMIT');

      // Return formatted batch
      return getBatchById(tenantId, newBatch.id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

/**
 * Add an approved expense to an existing OPEN finance batch.
 *
 * @param {string} tenantId - Authenticated tenant UUID
 * @param {string} userId - Authenticated user UUID (Finance)
 * @param {string} userRole - Authenticated user role
 * @param {string} batchId - Batch UUID
 * @param {string} receiptId - Receipt UUID to add
 * @returns {Promise<object>} Updated batch
 */
async function addExpenseToBatch(tenantId, userId, userRole, batchId, receiptId) {
  if (userRole !== 'FINANCE') {
    const error = new Error('Forbidden: Only FINANCE role can modify finance batches');
    error.status = 403;
    throw error;
  }

  if (!isValidUuid(batchId)) {
    const error = new Error(`Validation failed: Invalid batch ID format: '${batchId}' is not a valid UUID`);
    error.status = 400;
    throw error;
  }

  if (!isValidUuid(receiptId)) {
    const error = new Error(`Validation failed: Invalid receipt ID format: '${receiptId}' is not a valid UUID`);
    error.status = 400;
    throw error;
  }

  return withTenantContext(tenantId, async (client) => {
    await client.query('BEGIN');

    try {
      // 1. Lock batch
      const { rows: batchRows } = await client.query(
        'SELECT * FROM finance_batches WHERE id = $1 FOR UPDATE',
        [batchId]
      );
      if (!batchRows[0]) {
        const error = new Error('Finance batch not found');
        error.status = 404;
        throw error;
      }

      const batch = batchRows[0];
      if (batch.status !== BATCH_STATUSES.OPEN) {
        const error = new Error(`Cannot add expenses to a batch with status '${batch.status}'. Only OPEN batches can be modified.`);
        error.status = 400;
        throw error;
      }

      // 2. Lock receipt and verify eligibility
      const receiptQuery = `
        SELECT r.id, r.tenant_id,
               re.ai_total_amount, re.confirmed_total_amount,
               ew.current_state as workflow_state
        FROM receipts r
        LEFT JOIN expense_workflows ew ON r.id = ew.receipt_id
        LEFT JOIN receipt_extractions re ON r.id = re.receipt_id
        WHERE r.id = $1
        FOR UPDATE OF r
      `;

      const { rows: receiptRows } = await client.query(receiptQuery, [receiptId]);
      if (!receiptRows[0]) {
        const error = new Error('Receipt not found');
        error.status = 404;
        throw error;
      }

      const r = receiptRows[0];
      if (r.workflow_state !== 'APPROVED') {
        const error = new Error(`Validation failed: Only APPROVED expenses may enter a finance batch. Receipt is in '${r.workflow_state || 'UNSUBMITTED'}' state.`);
        error.status = 400;
        throw error;
      }

      // Check if already in this batch (PRD FR-09.3)
      const { rows: dupRows } = await client.query(
        'SELECT id FROM finance_batch_items WHERE batch_id = $1 AND receipt_id = $2',
        [batchId, receiptId]
      );
      if (dupRows.length > 0) {
        const error = new Error('Validation failed: Expense is already included in this finance batch');
        error.status = 400;
        throw error;
      }

      const rawAmount = r.confirmed_total_amount !== null && r.confirmed_total_amount !== undefined
        ? r.confirmed_total_amount
        : r.ai_total_amount;

      const parsed = parseToCents(rawAmount);
      if (!parsed.valid || parsed.cents <= 0) {
        const error = new Error(`Validation failed: Receipt ${receiptId} has invalid or non-positive amount: ${rawAmount}`);
        error.status = 400;
        throw error;
      }

      // 3. Insert item
      await client.query(
        'INSERT INTO finance_batch_items (batch_id, receipt_id, tenant_id, amount) VALUES ($1, $2, $3, $4)',
        [batchId, receiptId, tenantId, parsed.formatted]
      );

      // 4. Recalculate batch totals deterministically
      const { rows: itemsRows } = await client.query(
        'SELECT amount FROM finance_batch_items WHERE batch_id = $1',
        [batchId]
      );

      let newTotalCents = 0;
      for (const it of itemsRows) {
        newTotalCents += parseToCents(it.amount).cents;
      }

      const newTotalFormatted = (newTotalCents / 100).toFixed(2);
      const newCount = itemsRows.length;

      await client.query(
        'UPDATE finance_batches SET total_amount = $1, expense_count = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
        [newTotalFormatted, newCount, batchId]
      );

      // 5. Record audit action
      await client.query(
        'INSERT INTO finance_batch_actions (batch_id, tenant_id, actor_id, actor_role, action, affected_receipt_id, details) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [batchId, tenantId, userId, userRole, BATCH_ACTIONS.ADD_ITEM, receiptId, `Added receipt ${receiptId} ($${parsed.formatted}) to batch`]
      );

      await client.query('COMMIT');

      return getBatchById(tenantId, batchId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

/**
 * Remove an expense from an existing OPEN finance batch.
 *
 * Critical requirement: Removing an expense leaves its approval state intact ('APPROVED').
 * It simply removes it from the batch items and updates batch totals.
 *
 * @param {string} tenantId - Authenticated tenant UUID
 * @param {string} userId - Authenticated user UUID (Finance)
 * @param {string} userRole - Authenticated user role
 * @param {string} batchId - Batch UUID
 * @param {string} receiptId - Receipt UUID to remove
 * @returns {Promise<object>} Updated batch
 */
async function removeExpenseFromBatch(tenantId, userId, userRole, batchId, receiptId) {
  if (userRole !== 'FINANCE') {
    const error = new Error('Forbidden: Only FINANCE role can modify finance batches');
    error.status = 403;
    throw error;
  }

  if (!isValidUuid(batchId)) {
    const error = new Error(`Validation failed: Invalid batch ID format: '${batchId}' is not a valid UUID`);
    error.status = 400;
    throw error;
  }

  if (!isValidUuid(receiptId)) {
    const error = new Error(`Validation failed: Invalid receipt ID format: '${receiptId}' is not a valid UUID`);
    error.status = 400;
    throw error;
  }

  return withTenantContext(tenantId, async (client) => {
    await client.query('BEGIN');

    try {
      // 1. Lock batch
      const { rows: batchRows } = await client.query(
        'SELECT * FROM finance_batches WHERE id = $1 FOR UPDATE',
        [batchId]
      );
      if (!batchRows[0]) {
        const error = new Error('Finance batch not found');
        error.status = 404;
        throw error;
      }

      const batch = batchRows[0];
      if (batch.status !== BATCH_STATUSES.OPEN) {
        const error = new Error(`Cannot remove expenses from a batch with status '${batch.status}'. Only OPEN batches can be modified.`);
        error.status = 400;
        throw error;
      }

      // 2. Lock and verify item exists in this batch
      const { rows: itemRows } = await client.query(
        'SELECT * FROM finance_batch_items WHERE batch_id = $1 AND receipt_id = $2 FOR UPDATE',
        [batchId, receiptId]
      );
      if (!itemRows[0]) {
        const error = new Error('Receipt is not an item of this finance batch');
        error.status = 404;
        throw error;
      }

      const removedItem = itemRows[0];

      // 3. Delete item
      await client.query(
        'DELETE FROM finance_batch_items WHERE id = $1',
        [removedItem.id]
      );

      // 4. Recalculate batch totals deterministically
      const { rows: remainingRows } = await client.query(
        'SELECT amount FROM finance_batch_items WHERE batch_id = $1',
        [batchId]
      );

      let newTotalCents = 0;
      for (const it of remainingRows) {
        newTotalCents += parseToCents(it.amount).cents;
      }

      const newTotalFormatted = (newTotalCents / 100).toFixed(2);
      const newCount = remainingRows.length;

      await client.query(
        'UPDATE finance_batches SET total_amount = $1, expense_count = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
        [newTotalFormatted, newCount, batchId]
      );

      // 5. Record audit action
      await client.query(
        'INSERT INTO finance_batch_actions (batch_id, tenant_id, actor_id, actor_role, action, affected_receipt_id, details) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [batchId, tenantId, userId, userRole, BATCH_ACTIONS.REMOVE_ITEM, receiptId, `Removed receipt ${receiptId} ($${removedItem.amount}) from batch`]
      );

      await client.query('COMMIT');

      return getBatchById(tenantId, batchId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

/**
 * Complete finance review of a batch, transitioning status to REVIEWED.
 *
 * Once reviewed, the batch is locked from further item additions/removals
 * and is ready for CP8 Journal Entry generation.
 *
 * @param {string} tenantId - Authenticated tenant UUID
 * @param {string} userId - Authenticated user UUID (Finance)
 * @param {string} userRole - Authenticated user role
 * @param {string} batchId - Batch UUID
 * @returns {Promise<object>} Reviewed batch
 */
async function reviewBatch(tenantId, userId, userRole, batchId) {
  if (userRole !== 'FINANCE') {
    const error = new Error('Forbidden: Only FINANCE role can review finance batches');
    error.status = 403;
    throw error;
  }

  return withTenantContext(tenantId, async (client) => {
    await client.query('BEGIN');

    try {
      // 1. Lock batch
      const { rows: batchRows } = await client.query(
        'SELECT * FROM finance_batches WHERE id = $1 FOR UPDATE',
        [batchId]
      );
      if (!batchRows[0]) {
        const error = new Error('Finance batch not found');
        error.status = 404;
        throw error;
      }

      const batch = batchRows[0];
      if (batch.status === BATCH_STATUSES.REVIEWED) {
        const error = new Error('Finance batch has already been reviewed');
        error.status = 400;
        throw error;
      }

      if (batch.expense_count === 0) {
        const error = new Error('Cannot review an empty finance batch. Batch must contain at least one approved expense.');
        error.status = 400;
        throw error;
      }

      // 2. Update batch status to REVIEWED
      const updateQuery = `
        UPDATE finance_batches
        SET status = 'REVIEWED',
            reviewed_by = $2,
            reviewed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `;

      await client.query(updateQuery, [batchId, userId]);

      // 3. Record audit action
      await client.query(
        'INSERT INTO finance_batch_actions (batch_id, tenant_id, actor_id, actor_role, action, details) VALUES ($1, $2, $3, $4, $5, $6)',
        [batchId, tenantId, userId, userRole, BATCH_ACTIONS.REVIEW, 'Finance review completed']
      );

      await client.query('COMMIT');

      return getBatchById(tenantId, batchId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

module.exports = {
  BATCH_STATUSES,
  BATCH_ACTIONS,
  getEligibleApprovedExpenses,
  getBatches,
  getBatchById,
  createBatch,
  addExpenseToBatch,
  removeExpenseFromBatch,
  reviewBatch,
};
