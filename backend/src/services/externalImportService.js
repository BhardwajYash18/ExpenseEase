const crypto = require('crypto');
const { withTenantContext } = require('../config/db');
const { parseToCents } = require('./policy/decimalUtils');

/**
 * External Financial Data Import Service
 *
 * Implements Feature C: Validating, previewing, and posting external financial data
 * into deterministic double-entry journal entries.
 */

/**
 * Parse and validate CSV data.
 */
function parseFinancialCsv(csvText) {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    return {
      valid: false,
      error: 'CSV file is empty or missing data rows',
      rows: [],
    };
  }

  // Parse header
  const headerParts = lines[0].split(',').map((h) => h.trim().replace(/^["']|["']$/g, '').toLowerCase());

  const dateIdx = headerParts.findIndex((h) => h.includes('date'));
  const accountIdx = headerParts.findIndex((h) => h.includes('account') || h.includes('category') || h.includes('gl'));
  const descIdx = headerParts.findIndex((h) => h.includes('desc') || h.includes('memo') || h.includes('payee') || h.includes('merchant'));
  const debitIdx = headerParts.findIndex((h) => h === 'debit' || h.includes('debit'));
  const creditIdx = headerParts.findIndex((h) => h === 'credit' || h.includes('credit'));
  const amountIdx = headerParts.findIndex((h) => h === 'amount');

  if (dateIdx === -1) {
    return { valid: false, error: 'CSV must contain a Date column', rows: [] };
  }
  if (accountIdx === -1) {
    return { valid: false, error: 'CSV must contain an Account or Category column', rows: [] };
  }
  if (debitIdx === -1 && creditIdx === -1 && amountIdx === -1) {
    return { valid: false, error: 'CSV must contain Debit and Credit columns (or Amount column)', rows: [] };
  }

  const parsedRows = [];
  const errors = [];

  let totalDebitCents = 0;
  let totalCreditCents = 0;

  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i];
    // Simple CSV parser supporting quotes
    const cells = [];
    let cur = '';
    let inQuotes = false;
    for (let c = 0; c < rawLine.length; c++) {
      const char = rawLine[c];
      if (char === '"' || char === "'") {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        cells.push(cur.trim());
        cur = '';
      } else {
        cur += char;
      }
    }
    cells.push(cur.trim());

    const dateVal = cells[dateIdx] || '';
    const accountVal = cells[accountIdx] || '';
    const descVal = descIdx !== -1 ? cells[descIdx] || '' : '';

    // Validate date format YYYY-MM-DD
    const isoDateMatch = dateVal.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!isoDateMatch) {
      errors.push(`Row ${i}: Invalid date '${dateVal}'. Expected YYYY-MM-DD format.`);
      continue;
    }

    if (!accountVal) {
      errors.push(`Row ${i}: Missing Account or Category.`);
      continue;
    }

    let debitCents = 0;
    let creditCents = 0;

    if (debitIdx !== -1 && creditIdx !== -1) {
      const rawDebit = cells[debitIdx] || '0';
      const rawCredit = cells[creditIdx] || '0';

      const dParsed = parseToCents(rawDebit || 0);
      const cParsed = parseToCents(rawCredit || 0);

      if (!dParsed.valid || !cParsed.valid) {
        errors.push(`Row ${i}: Invalid debit/credit amount.`);
        continue;
      }

      debitCents = dParsed.cents;
      creditCents = cParsed.cents;
    } else if (amountIdx !== -1) {
      const rawAmt = cells[amountIdx] || '0';
      const num = Number(rawAmt);
      if (isNaN(num)) {
        errors.push(`Row ${i}: Invalid amount '${rawAmt}'.`);
        continue;
      }
      if (num >= 0) {
        debitCents = Math.round(num * 100);
      } else {
        creditCents = Math.round(Math.abs(num) * 100);
      }
    }

    if (debitCents === 0 && creditCents === 0) {
      errors.push(`Row ${i}: Both debit and credit amounts are zero.`);
      continue;
    }

    totalDebitCents += debitCents;
    totalCreditCents += creditCents;

    parsedRows.push({
      lineNumber: i,
      date: dateVal,
      account: accountVal,
      description: descVal || `External transaction ${i}`,
      debitAmount: (debitCents / 100).toFixed(2),
      creditAmount: (creditCents / 100).toFixed(2),
      debitCents,
      creditCents,
    });
  }

  const isBalanced = totalDebitCents === totalCreditCents && totalDebitCents > 0;
  if (!isBalanced && parsedRows.length > 0) {
    errors.push(
      `Debit/Credit imbalance: Total Debits (${(totalDebitCents / 100).toFixed(2)}) != Total Credits (${(
        totalCreditCents / 100
      ).toFixed(2)})`
    );
  }

  return {
    valid: errors.length === 0 && isBalanced,
    errors,
    rows: parsedRows,
    totalDebit: (totalDebitCents / 100).toFixed(2),
    totalCredit: (totalCreditCents / 100).toFixed(2),
    rowCount: parsedRows.length,
    isBalanced,
  };
}

/**
 * Validate and preview an external financial CSV file.
 * Saves a preview record in `external_financial_imports`.
 */
async function validateAndPreviewCsv(tenantId, actorId, csvBufferOrString, originalFilename) {
  const content = typeof csvBufferOrString === 'string' ? csvBufferOrString : csvBufferOrString.toString('utf8');
  const fileHash = crypto.createHash('sha256').update(content).digest('hex');

  return withTenantContext(tenantId, async (client) => {
    // 1. Check for duplicate upload
    const { rows: dupRows } = await client.query(
      'SELECT id, original_filename, created_at, status FROM external_financial_imports WHERE tenant_id = $1 AND file_hash = $2',
      [tenantId, fileHash]
    );

    if (dupRows.length > 0) {
      const existing = dupRows[0];
      const err = new Error(
        `Duplicate file detected: This file was already uploaded on ${new Date(existing.created_at).toLocaleDateString()} as '${existing.original_filename}' (Status: ${existing.status})`
      );
      err.status = 409;
      throw err;
    }

    // 2. Parse and validate CSV
    const parsed = parseFinancialCsv(content);
    if (!parsed.valid && parsed.rows.length === 0) {
      const err = new Error(`CSV Parsing Error: ${parsed.error || parsed.errors.join('; ')}`);
      err.status = 400;
      throw err;
    }

    // 3. Insert preview record
    const insertSql = `
      INSERT INTO external_financial_imports (
        tenant_id, original_filename, file_hash, total_debit, total_credit,
        row_count, status, uploaded_by, raw_records
      ) VALUES ($1, $2, $3, $4, $5, $6, 'PREVIEWED', $7, $8)
      RETURNING *
    `;

    const { rows: inserted } = await client.query(insertSql, [
      tenantId,
      originalFilename || 'financial_import.csv',
      fileHash,
      parsed.totalDebit,
      parsed.totalCredit,
      parsed.rowCount,
      actorId,
      JSON.stringify(parsed.rows),
    ]);

    const importRecord = inserted[0];

    return {
      importId: importRecord.id,
      originalFilename: importRecord.original_filename,
      status: importRecord.status,
      totalDebit: Number(importRecord.total_debit),
      totalCredit: Number(importRecord.total_credit),
      rowCount: importRecord.row_count,
      isBalanced: parsed.isBalanced,
      errors: parsed.errors,
      previewRows: parsed.rows.slice(0, 50),
      canCommit: parsed.valid,
    };
  });
}

/**
 * Commit a previewed external import into a double-entry Journal Entry.
 */
async function commitExternalImport(tenantId, actorId, importId, options = {}) {
  const { finalizeImmediately = true } = options;

  return withTenantContext(tenantId, async (client) => {
    // 1. Fetch import record
    const { rows: importRows } = await client.query(
      'SELECT * FROM external_financial_imports WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
      [importId, tenantId]
    );

    if (!importRows[0]) {
      const err = new Error('External import record not found');
      err.status = 404;
      throw err;
    }

    const record = importRows[0];
    if (record.status !== 'PREVIEWED') {
      const err = new Error(`Cannot commit import in '${record.status}' status`);
      err.status = 400;
      throw err;
    }

    const rawRows = record.raw_records || [];
    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      const err = new Error('Import contains no transaction rows');
      err.status = 400;
      throw err;
    }

    // Validate balance
    const totalDebit = Number(record.total_debit);
    const totalCredit = Number(record.total_credit);
    if (totalDebit !== totalCredit || totalDebit <= 0) {
      const err = new Error(`Imbalanced transactions cannot be committed to GL: Debits (${totalDebit}) != Credits (${totalCredit})`);
      err.status = 400;
      throw err;
    }

    const journalStatus = finalizeImmediately ? 'FINALIZED' : 'DRAFT';

    // 2. Insert journal entry
    const insertJeSql = `
      INSERT INTO journal_entries (
        tenant_id, batch_id, created_by, status, total_debit, total_credit,
        line_count, source_type, external_import_id, finalized_by, finalized_at
      ) VALUES ($1, NULL, $2, $3, $4, $5, $6, 'EXTERNAL_IMPORT', $7, $8, $9)
      RETURNING *
    `;

    const { rows: jeRows } = await client.query(insertJeSql, [
      tenantId,
      actorId,
      journalStatus,
      totalDebit.toFixed(2),
      totalCredit.toFixed(2),
      rawRows.length,
      importId,
      finalizeImmediately ? actorId : null,
      finalizeImmediately ? new Date().toISOString() : null,
    ]);

    const journalEntry = jeRows[0];

    // 3. Insert journal entry lines
    let lineOrder = 1;
    for (const r of rawRows) {
      await client.query(
        `INSERT INTO journal_entry_lines (
          journal_entry_id, tenant_id, line_order, account, debit_amount, credit_amount, description
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          journalEntry.id,
          tenantId,
          lineOrder++,
          r.account,
          Number(r.debitAmount || 0).toFixed(2),
          Number(r.creditAmount || 0).toFixed(2),
          `[Import: ${record.original_filename}] ${r.description || ''}`,
        ]
      );
    }

    // 4. Record journal entry audit action
    await client.query(
      `INSERT INTO journal_entry_actions (
        journal_entry_id, tenant_id, actor_id, actor_role, action, details
      ) VALUES ($1, $2, $3, 'FINANCE', $4, $5)`,
      [
        journalEntry.id,
        tenantId,
        actorId,
        finalizeImmediately ? 'FINALIZE' : 'GENERATE',
        `Imported from external file: ${record.original_filename} (${rawRows.length} lines)`,
      ]
    );

    // 5. Update external import record
    await client.query(
      `UPDATE external_financial_imports SET
        status = 'POSTED',
        journal_entry_id = $1,
        posted_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [journalEntry.id, importId]
    );

    return {
      importId,
      status: 'POSTED',
      journalEntryId: journalEntry.id,
      journalEntryStatus: journalStatus,
      totalDebit,
      totalCredit,
      lineCount: rawRows.length,
      originalFilename: record.original_filename,
    };
  });
}

/**
 * List all external imports for the tenant.
 */
async function listExternalImports(tenantId) {
  return withTenantContext(tenantId, async (client) => {
    const query = `
      SELECT efi.*,
             TRIM(CONCAT(u.first_name, ' ', u.last_name)) as uploaded_by_name,
             je.status as journal_entry_status
      FROM external_financial_imports efi
      LEFT JOIN users u ON efi.uploaded_by = u.id
      LEFT JOIN journal_entries je ON efi.journal_entry_id = je.id
      ORDER BY efi.created_at DESC
      LIMIT 50
    `;
    const { rows } = await client.query(query);
    return rows.map((r) => ({
      id: r.id,
      originalFilename: r.original_filename,
      status: r.status,
      totalDebit: Number(r.total_debit),
      totalCredit: Number(r.total_credit),
      rowCount: r.row_count,
      journalEntryId: r.journal_entry_id,
      journalEntryStatus: r.journal_entry_status,
      uploadedByName: r.uploaded_by_name || 'Finance User',
      createdAt: r.created_at,
      postedAt: r.posted_at,
    }));
  });
}

module.exports = {
  parseFinancialCsv,
  validateAndPreviewCsv,
  commitExternalImport,
  listExternalImports,
};
