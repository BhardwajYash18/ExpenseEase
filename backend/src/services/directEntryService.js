const axios = require('axios');
const config = require('../config/env');
const { withTenantContext } = require('../config/db');
const { parseToCents } = require('./policy/decimalUtils');
const storageService = require('./storageService');
const { validateReceiptFile, sanitizeFilename } = require('../utils/fileValidation');

/**
 * Direct Financial Entry Service (Feature B)
 *
 * Allows Finance users to enter bills, supplier invoices, and direct payments
 * independently of employee reimbursement workflows.
 */

const ALLOWED_SOURCES = new Set([
  'SUPPLIER_BILL',
  'EXTERNAL_INVOICE',
  'DIRECT_PAYMENT',
  'WIRE_TRANSFER',
  'OTHER',
]);

/**
 * Create a new direct financial entry in DRAFT status.
 */
async function createDirectEntry(tenantId, userId, data, file = null) {
  const {
    transactionDate,
    vendor,
    referenceNumber = null,
    sourceType = 'SUPPLIER_BILL',
    category = 'Other',
    amount,
    taxAmount = 0.00,
    currency = 'USD',
    debitAccount,
    creditAccount,
    description,
    notes = null,
    reconciliationStatus = 'UNRECONCILED',
  } = data;

  // 1. Validation
  if (!transactionDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(transactionDate))) {
    const err = new Error('transactionDate is required and must be in YYYY-MM-DD format');
    err.status = 400;
    throw err;
  }

  if (!vendor || typeof vendor !== 'string' || !vendor.trim()) {
    const err = new Error('vendor is required');
    err.status = 400;
    throw err;
  }

  if (!debitAccount || typeof debitAccount !== 'string' || !debitAccount.trim()) {
    const err = new Error('debitAccount is required');
    err.status = 400;
    throw err;
  }

  if (!creditAccount || typeof creditAccount !== 'string' || !creditAccount.trim()) {
    const err = new Error('creditAccount is required');
    err.status = 400;
    throw err;
  }

  if (!description || typeof description !== 'string' || !description.trim()) {
    const err = new Error('description is required');
    err.status = 400;
    throw err;
  }

  const parsedAmount = parseToCents(amount);
  if (!parsedAmount.valid || parsedAmount.cents <= 0) {
    const err = new Error('amount must be a valid positive number');
    err.status = 400;
    throw err;
  }

  const cleanSource = ALLOWED_SOURCES.has(sourceType) ? sourceType : 'SUPPLIER_BILL';
  const cleanRef = referenceNumber && String(referenceNumber).trim() ? String(referenceNumber).trim() : null;
  const cleanVendor = vendor.trim().slice(0, 255);
  const cleanCurr = currency ? String(currency).trim().toUpperCase().slice(0, 3) : 'USD';
  const entryNumber = `DE-${Date.now().toString().slice(-6)}`;

  // 2. Optional File Storage
  let storageKey = null;
  let filename = null;
  let mimeType = null;

  if (file) {
    const val = validateReceiptFile(file);
    if (!val.valid) {
      const err = new Error(val.error);
      err.status = 400;
      throw err;
    }
    storageKey = storageService.generateStorageKey(tenantId, file.mimetype);
    filename = sanitizeFilename(file.originalname);
    mimeType = file.mimetype;
    await storageService.storeFile(storageKey, file.buffer);
  }

  return withTenantContext(tenantId, async (client) => {
    // 3. Duplicate check by vendor + reference number
    if (cleanRef) {
      const { rows: dupRows } = await client.query(
        `SELECT id, entry_number FROM direct_financial_entries
         WHERE tenant_id = $1 AND LOWER(TRIM(vendor)) = LOWER(TRIM($2)) AND LOWER(TRIM(reference_number)) = LOWER(TRIM($3))`,
        [tenantId, cleanVendor, cleanRef]
      );
      if (dupRows.length > 0) {
        const err = new Error(`Duplicate entry: Reference '${cleanRef}' from vendor '${cleanVendor}' already exists (#${dupRows[0].entry_number})`);
        err.status = 409;
        throw err;
      }
    }

    // 4. Insert entry
    const insertSql = `
      INSERT INTO direct_financial_entries (
        tenant_id, created_by, entry_number, transaction_date, vendor,
        reference_number, source_type, category, amount, tax_amount,
        currency, debit_account, credit_account, description, notes,
        reconciliation_status, status, attachment_storage_key,
        attachment_filename, attachment_mime_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'DRAFT', $17, $18, $19)
      RETURNING *
    `;

    const { rows: inserted } = await client.query(insertSql, [
      tenantId,
      userId,
      entryNumber,
      transactionDate,
      cleanVendor,
      cleanRef,
      cleanSource,
      category,
      parsedAmount.formatted,
      Number(taxAmount || 0).toFixed(2),
      cleanCurr,
      debitAccount.trim(),
      creditAccount.trim(),
      description.trim(),
      notes ? notes.trim() : null,
      reconciliationStatus,
      storageKey,
      filename,
      mimeType,
    ]);

    const entry = inserted[0];

    // 5. Record audit action
    await client.query(
      `INSERT INTO direct_financial_entry_actions (entry_id, tenant_id, actor_id, action, details)
       VALUES ($1, $2, $3, 'CREATE', $4)`,
      [entry.id, tenantId, userId, `Created direct financial entry #${entry.entry_number} for vendor ${cleanVendor} (${cleanCurr} ${parsedAmount.formatted})`]
    );

    return formatDirectEntry(entry);
  });
}

/**
 * List direct financial entries for the tenant.
 */
async function listDirectEntries(tenantId, options = {}) {
  const page = Math.max(parseInt(options.page) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(options.pageSize) || 20, 1), 100);
  const offset = (page - 1) * pageSize;

  return withTenantContext(tenantId, async (client) => {
    let query = `
      SELECT de.*,
             TRIM(CONCAT(u.first_name, ' ', u.last_name)) as created_by_name,
             TRIM(CONCAT(p.first_name, ' ', p.last_name)) as posted_by_name,
             COUNT(*) OVER() as full_count
      FROM direct_financial_entries de
      JOIN users u ON de.created_by = u.id
      LEFT JOIN users p ON de.posted_by = p.id
    `;
    const params = [];
    const conditions = [];

    if (options.status && options.status !== 'ALL') {
      params.push(options.status);
      conditions.push(`de.status = $${params.length}`);
    }

    if (options.search) {
      params.push(`%${options.search}%`);
      conditions.push(`(de.vendor ILIKE $${params.length} OR de.reference_number ILIKE $${params.length} OR de.description ILIKE $${params.length})`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(' AND ');
    }

    params.push(pageSize, offset);
    query += ` ORDER BY de.transaction_date DESC, de.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const { rows } = await client.query(query, params);
    const total = rows.length > 0 ? parseInt(rows[0].full_count, 10) : 0;
    const totalPages = Math.ceil(total / pageSize) || 1;

    return {
      entries: rows.map(formatDirectEntry),
      total,
      page,
      pageSize,
      totalPages,
    };
  });
}

/**
 * Get direct financial entry by ID including audit history.
 */
async function getDirectEntryById(tenantId, entryId) {
  return withTenantContext(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT de.*,
              TRIM(CONCAT(u.first_name, ' ', u.last_name)) as created_by_name,
              TRIM(CONCAT(p.first_name, ' ', p.last_name)) as posted_by_name
       FROM direct_financial_entries de
       JOIN users u ON de.created_by = u.id
       LEFT JOIN users p ON de.posted_by = p.id
       WHERE de.id = $1`,
      [entryId]
    );

    if (!rows[0]) return null;

    const { rows: actionRows } = await client.query(
      `SELECT a.*, TRIM(CONCAT(u.first_name, ' ', u.last_name)) as actor_name
       FROM direct_financial_entry_actions a
       JOIN users u ON a.actor_id = u.id
       WHERE a.entry_id = $1
       ORDER BY a.created_at ASC`,
      [entryId]
    );

    return {
      ...formatDirectEntry(rows[0]),
      auditHistory: actionRows.map((a) => ({
        id: a.id,
        action: a.action,
        details: a.details,
        actorName: a.actor_name,
        createdAt: a.created_at,
      })),
    };
  });
}

/**
 * Post a direct financial entry to a finalized double-entry Journal Entry.
 */
async function postDirectEntry(tenantId, userId, entryId) {
  return withTenantContext(tenantId, async (client) => {
    await client.query('BEGIN');
    try {
      // 1. Fetch and lock entry
      const { rows } = await client.query(
        'SELECT * FROM direct_financial_entries WHERE id = $1 FOR UPDATE',
        [entryId]
      );

      if (!rows[0]) {
        const err = new Error('Direct financial entry not found');
        err.status = 404;
        throw err;
      }

      const entry = rows[0];
      if (entry.status !== 'DRAFT') {
        const err = new Error(`Cannot post entry in '${entry.status}' status`);
        err.status = 400;
        throw err;
      }

      const amount = Number(entry.amount);

      // 2. Create Journal Entry
      const { rows: jeRows } = await client.query(
        `INSERT INTO journal_entries (
          tenant_id, batch_id, created_by, status, total_debit, total_credit,
          line_count, source_type, finalized_by, finalized_at
        ) VALUES ($1, NULL, $2, 'FINALIZED', $3, $4, 2, 'DIRECT_ENTRY', $2, CURRENT_TIMESTAMP)
        RETURNING *`,
        [tenantId, userId, amount.toFixed(2), amount.toFixed(2)]
      );

      const journalEntry = jeRows[0];

      // 3. Create Journal Entry Lines (Debit Expense, Credit Payable/Cash)
      // Line 1: Debit Line
      await client.query(
        `INSERT INTO journal_entry_lines (
          journal_entry_id, tenant_id, line_order, account, debit_amount, credit_amount, description
        ) VALUES ($1, $2, 1, $3, $4, 0.00, $5)`,
        [
          journalEntry.id,
          tenantId,
          entry.debit_account,
          amount.toFixed(2),
          `[Direct Entry: ${entry.vendor}] ${entry.description}`,
        ]
      );

      // Line 2: Credit Line
      await client.query(
        `INSERT INTO journal_entry_lines (
          journal_entry_id, tenant_id, line_order, account, debit_amount, credit_amount, description
        ) VALUES ($1, $2, 2, $3, 0.00, $4, $5)`,
        [
          journalEntry.id,
          tenantId,
          entry.credit_account,
          amount.toFixed(2),
          `[Payable/Settlement: ${entry.vendor}] Ref: ${entry.reference_number || entry.entry_number}`,
        ]
      );

      // 4. Record Journal Entry Action
      await client.query(
        `INSERT INTO journal_entry_actions (
          journal_entry_id, tenant_id, actor_id, actor_role, action, details
        ) VALUES ($1, $2, $3, 'FINANCE', 'FINALIZE', $4)`,
        [
          journalEntry.id,
          tenantId,
          userId,
          `Generated and finalized from Direct Financial Entry #${entry.entry_number} (${entry.vendor})`,
        ]
      );

      // 5. Update Direct Financial Entry
      await client.query(
        `UPDATE direct_financial_entries SET
          status = 'POSTED',
          posted_at = CURRENT_TIMESTAMP,
          posted_by = $1,
          journal_entry_id = $2,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [userId, journalEntry.id, entryId]
      );

      // 6. Record Direct Financial Entry Action
      await client.query(
        `INSERT INTO direct_financial_entry_actions (entry_id, tenant_id, actor_id, action, details)
         VALUES ($1, $2, $3, 'POST', $4)`,
        [entryId, tenantId, userId, `Posted to General Ledger Journal Entry #${journalEntry.id.slice(0, 8)}`]
      );

      await client.query('COMMIT');

      return {
        entryId,
        status: 'POSTED',
        journalEntryId: journalEntry.id,
        amount,
        postedAt: new Date().toISOString(),
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

/**
 * Retrieve attached file for streaming/download.
 */
async function getDirectEntryAttachment(tenantId, entryId) {
  return withTenantContext(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT attachment_storage_key, attachment_filename, attachment_mime_type
       FROM direct_financial_entries WHERE id = $1`,
      [entryId]
    );

    if (!rows[0] || !rows[0].attachment_storage_key) return null;

    const { attachment_storage_key, attachment_filename, attachment_mime_type } = rows[0];
    const buffer = await storageService.readFile(attachment_storage_key);

    return {
      buffer,
      filename: attachment_filename,
      mimeType: attachment_mime_type,
    };
  });
}

/**
 * Preview OCR extraction for a supporting document before saving direct entry.
 */
async function previewDirectEntryOcr(file) {
  if (!file) {
    const err = new Error('No document provided for OCR extraction');
    err.status = 400;
    throw err;
  }

  const val = validateReceiptFile(file);
  if (!val.valid) {
    const err = new Error(val.error);
    err.status = 400;
    throw err;
  }

  let rawText = '';
  try {
    const FormData = require('form-data');
    const formData = new FormData();
    formData.append('file', file.buffer, {
      filename: file.originalname || 'document.jpg',
      contentType: file.mimetype || 'image/jpeg',
    });

    const ocrRes = await axios.post(`${config.aiServiceUrl}/ocr/extract`, formData, {
      headers: formData.getHeaders(),
      timeout: 30000,
    });
    rawText = ocrRes.data?.raw_text || '';
  } catch (err) {
    console.warn('[DirectEntry] OCR extraction failed or unavailable:', err.message);
  }

  const preview = {
    merchantName: null,
    receiptDate: null,
    totalAmount: null,
    taxAmount: null,
    currency: 'USD',
    category: 'Other',
    rawText,
  };

  if (rawText && rawText.trim()) {
    try {
      const extRes = await axios.post(`${config.aiServiceUrl}/receipt/extract`, {
        ocr_text: rawText,
      }, { timeout: 30000 });

      if (extRes.data) {
        preview.merchantName = extRes.data.merchant_name || null;
        preview.receiptDate = extRes.data.receipt_date || null;
        preview.totalAmount = extRes.data.total_amount ? Number(extRes.data.total_amount) : null;
        preview.taxAmount = extRes.data.tax_amount ? Number(extRes.data.tax_amount) : null;
        preview.currency = extRes.data.currency || 'USD';
        preview.category = extRes.data.category || 'Other';
      }
    } catch (err) {
      console.warn('[DirectEntry] Structured extraction failed:', err.message);
    }
  }

  return preview;
}

function formatDirectEntry(r) {
  return {
    id: r.id,
    entryNumber: r.entry_number,
    transactionDate: r.transaction_date,
    vendor: r.vendor,
    referenceNumber: r.reference_number,
    sourceType: r.source_type,
    category: r.category,
    amount: Number(r.amount),
    taxAmount: Number(r.tax_amount || 0),
    currency: r.currency,
    debitAccount: r.debit_account,
    creditAccount: r.credit_account,
    description: r.description,
    notes: r.notes,
    reconciliationStatus: r.reconciliation_status,
    status: r.status,
    attachmentFilename: r.attachment_filename,
    hasAttachment: Boolean(r.attachment_storage_key),
    journalEntryId: r.journal_entry_id,
    postedAt: r.posted_at,
    createdByName: r.created_by_name || null,
    postedByName: r.posted_by_name || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

module.exports = {
  createDirectEntry,
  listDirectEntries,
  getDirectEntryById,
  postDirectEntry,
  getDirectEntryAttachment,
  previewDirectEntryOcr,
};
