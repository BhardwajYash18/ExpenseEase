const request = require('supertest');
const app = require('../src/app');
const { pool, withTenantContext } = require('../src/config/db');
const authService = require('../src/services/authService');
const storageService = require('../src/services/storageService');
const accountMappingService = require('../src/services/accountMappingService');
const journalEntryService = require('../src/services/journalEntryService');

describe('Checkpoint 9 — CSV Export & Accounting Integrations (QuickBooks/Xero)', () => {
  let tenantAId, tenantBId, tenantEmptyId;
  let employeeAId, employeeAToken;
  let managerAId, managerAToken;
  let financeAId, financeAToken;
  let financeBId, financeBToken;
  let financeEmptyId, financeEmptyToken;

  let finalizedEntryAId, draftEntryAId, finalizedEntryBId;
  let reviewedBatchAId, openBatchAId, reviewedBatchBId;
  let receiptMealsId, receiptTravelId, receiptTenantBId;

  beforeAll(async () => {
    // 1. Setup tenants
    const slugA = `export-corp-${Date.now()}`;
    const slugB = `export-other-${Date.now()}`;
    const slugEmpty = `export-empty-${Date.now()}`;

    const tA = await pool.query(
      "INSERT INTO tenants (name, slug) VALUES ('Export Corp', $1) RETURNING id",
      [slugA]
    );
    tenantAId = tA.rows[0].id;

    const tB = await pool.query(
      "INSERT INTO tenants (name, slug) VALUES ('Export Other Ledger', $1) RETURNING id",
      [slugB]
    );
    tenantBId = tB.rows[0].id;

    const tEmpty = await pool.query(
      "INSERT INTO tenants (name, slug) VALUES ('Export Empty Corp', $1) RETURNING id",
      [slugEmpty]
    );
    tenantEmptyId = tEmpty.rows[0].id;

    // 2. Setup users in Tenant A
    await withTenantContext(tenantAId, async (client) => {
      const uEmp = await client.query(
        "INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role) VALUES ($1, $2, 'hash', 'Emp', 'A', 'EMPLOYEE') RETURNING id",
        [tenantAId, `emp.a.${Date.now()}@export.test`]
      );
      employeeAId = uEmp.rows[0].id;

      const uMgr = await client.query(
        "INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role) VALUES ($1, $2, 'hash', 'Mgr', 'A', 'MANAGER') RETURNING id",
        [tenantAId, `mgr.a.${Date.now()}@export.test`]
      );
      managerAId = uMgr.rows[0].id;

      const uFin = await client.query(
        "INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role) VALUES ($1, $2, 'hash', 'Fin', 'A', 'FINANCE') RETURNING id",
        [tenantAId, `fin.a.${Date.now()}@export.test`]
      );
      financeAId = uFin.rows[0].id;
    });

    // 3. Setup user in Tenant B
    await withTenantContext(tenantBId, async (client) => {
      const uFinB = await client.query(
        "INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role) VALUES ($1, $2, 'hash', 'Fin', 'B', 'FINANCE') RETURNING id",
        [tenantBId, `fin.b.${Date.now()}@other.test`]
      );
      financeBId = uFinB.rows[0].id;
    });

    // 4. Setup user in Empty Tenant
    await withTenantContext(tenantEmptyId, async (client) => {
      const uFinEmpty = await client.query(
        "INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role) VALUES ($1, $2, 'hash', 'Fin', 'Empty', 'FINANCE') RETURNING id",
        [tenantEmptyId, `fin.empty.${Date.now()}@empty.test`]
      );
      financeEmptyId = uFinEmpty.rows[0].id;
    });

    // Sign tokens
    employeeAToken = authService.signToken({ sub: employeeAId, tid: tenantAId, role: 'EMPLOYEE' });
    managerAToken = authService.signToken({ sub: managerAId, tid: tenantAId, role: 'MANAGER' });
    financeAToken = authService.signToken({ sub: financeAId, tid: tenantAId, role: 'FINANCE' });
    financeBToken = authService.signToken({ sub: financeBId, tid: tenantBId, role: 'FINANCE' });
    financeEmptyToken = authService.signToken({ sub: financeEmptyId, tid: tenantEmptyId, role: 'FINANCE' });

    // Seed default account mappings
    await accountMappingService.seedDefaultAccountMappings(tenantAId);
    await accountMappingService.seedDefaultAccountMappings(tenantBId);
    await accountMappingService.seedDefaultAccountMappings(tenantEmptyId);

    // Helper to create receipt in APPROVED state
    async function createApprovedReceipt(tenantId, userId, amount, category, merchant = 'Test Vendor') {
      const key = storageService.generateStorageKey(tenantId, 'image/jpeg');
      await storageService.storeFile(key, Buffer.from(`bytes for ${merchant}`));

      return withTenantContext(tenantId, async (client) => {
        const rRes = await client.query(
          `INSERT INTO receipts (
            tenant_id, uploaded_by, original_filename, mime_type, file_size_bytes, storage_key, upload_status, ocr_status, ocr_raw_text
          ) VALUES ($1, $2, 'receipt.jpg', 'image/jpeg', 100, $3, 'COMPLETED', 'COMPLETED', 'TEXT')
          RETURNING id`,
          [tenantId, userId, key]
        );
        const receiptId = rRes.rows[0].id;

        await client.query(
          `INSERT INTO receipt_extractions (
            receipt_id, tenant_id, extraction_status, ai_merchant_name, confirmed_merchant_name,
            ai_receipt_date, confirmed_receipt_date,
            ai_total_amount, confirmed_total_amount,
            ai_suggested_category, confirmed_category
          ) VALUES ($1, $2, 'COMPLETED', $3, $3, '2026-06-01', '2026-06-01', $4, $4, $5, $5)`,
          [receiptId, tenantId, merchant, amount, category]
        );

        await client.query(
          `INSERT INTO expense_workflows (
            tenant_id, receipt_id, submitted_by, current_state, submitted_at, completed_at
          ) VALUES ($1, $2, $3, 'APPROVED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [tenantId, receiptId, userId]
        );

        return receiptId;
      });
    }

    receiptMealsId = await createApprovedReceipt(tenantAId, employeeAId, 50.00, 'Meals', 'Bistro Cafe');
    receiptTravelId = await createApprovedReceipt(tenantAId, employeeAId, 150.00, 'Travel', 'Sky Airlines');
    receiptTenantBId = await createApprovedReceipt(tenantBId, financeBId, 80.00, 'Meals', 'Tenant B Bistro');

    // Create Finance Batches
    const createBatch = async (tenantToken, receiptIds, markReviewed = true) => {
      const res = await request(app)
        .post('/api/finance-batches')
        .set('Authorization', `Bearer ${tenantToken}`)
        .send({ receiptIds });
      const batchId = res.body.batch.id;

      if (markReviewed) {
        await request(app)
          .post(`/api/finance-batches/${batchId}/review`)
          .set('Authorization', `Bearer ${tenantToken}`);
      }
      return batchId;
    };

    reviewedBatchAId = await createBatch(financeAToken, [receiptMealsId, receiptTravelId], true);
    openBatchAId = await createBatch(financeAToken, [receiptMealsId], false);
    reviewedBatchBId = await createBatch(financeBToken, [receiptTenantBId], true);

    // Create journal entries:
    // 1. Finalized Journal Entry in Tenant A
    const genResA = await request(app)
      .post('/api/journal-entries/generate')
      .set('Authorization', `Bearer ${financeAToken}`)
      .send({ batchId: reviewedBatchAId });
    finalizedEntryAId = genResA.body.journalEntry.id;

    await request(app)
      .post(`/api/journal-entries/${finalizedEntryAId}/finalize`)
      .set('Authorization', `Bearer ${financeAToken}`);

    // 2. Draft Journal Entry in Tenant A (create a second reviewed batch for testing draft export rejection)
    const receiptDraftId = await createApprovedReceipt(tenantAId, employeeAId, 30.00, 'Meals', 'Draft Diner');
    const draftBatchId = await createBatch(financeAToken, [receiptDraftId], true);
    const genDraftRes = await request(app)
      .post('/api/journal-entries/generate')
      .set('Authorization', `Bearer ${financeAToken}`)
      .send({ batchId: draftBatchId });
    draftEntryAId = genDraftRes.body.journalEntry.id;

    // 3. Finalized Journal Entry in Tenant B
    const genResB = await request(app)
      .post('/api/journal-entries/generate')
      .set('Authorization', `Bearer ${financeBToken}`)
      .send({ batchId: reviewedBatchBId });
    finalizedEntryBId = genResB.body.journalEntry.id;

    await request(app)
      .post(`/api/journal-entries/${finalizedEntryBId}/finalize`)
      .set('Authorization', `Bearer ${financeBToken}`);
  });

  afterAll(async () => {
    // Cleanup audit logs, journal entries, and test data
    const tenantIds = [tenantAId, tenantBId, tenantEmptyId].filter(Boolean);
    for (const tId of tenantIds) {
      await withTenantContext(tId, async (client) => {
        await client.query('DELETE FROM export_audit_logs WHERE tenant_id = $1', [tId]);
        await client.query('DELETE FROM journal_entry_actions WHERE tenant_id = $1', [tId]);
        await client.query('DELETE FROM journal_entry_lines WHERE tenant_id = $1', [tId]);
        await client.query('DELETE FROM journal_entries WHERE tenant_id = $1', [tId]);
        await client.query('DELETE FROM finance_batch_actions WHERE tenant_id = $1', [tId]);
        await client.query('DELETE FROM finance_batch_items WHERE tenant_id = $1', [tId]);
        await client.query('DELETE FROM finance_batches WHERE tenant_id = $1', [tId]);
        await client.query('DELETE FROM expense_workflows WHERE tenant_id = $1', [tId]);
        await client.query('DELETE FROM receipt_extractions WHERE tenant_id = $1', [tId]);
        await client.query('DELETE FROM receipts WHERE tenant_id = $1', [tId]);
        await client.query('DELETE FROM account_mappings WHERE tenant_id = $1', [tId]);
        await client.query('DELETE FROM users WHERE tenant_id = $1', [tId]);
      });
      await pool.query('DELETE FROM tenants WHERE id = $1', [tId]);
    }
  });

  // =========================================================================
  // 1. AUTHENTICATION & RBAC
  // =========================================================================
  describe('Authentication & RBAC', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get('/api/export/csv');
      expect(res.status).toBe(401);
    });

    it('rejects EMPLOYEE role from exporting CSV with 403', async () => {
      const res = await request(app)
        .get(`/api/export/journal-entries/${finalizedEntryAId}/csv`)
        .set('Authorization', `Bearer ${employeeAToken}`);
      expect(res.status).toBe(403);
    });

    it('rejects MANAGER role from exporting CSV with 403', async () => {
      const res = await request(app)
        .get(`/api/export/journal-entries/${finalizedEntryAId}/csv`)
        .set('Authorization', `Bearer ${managerAToken}`);
      expect(res.status).toBe(403);
    });

    it('rejects EMPLOYEE role from triggering QuickBooks integration with 403', async () => {
      const res = await request(app)
        .post(`/api/export/integrations/quickbooks/${finalizedEntryAId}`)
        .set('Authorization', `Bearer ${employeeAToken}`);
      expect(res.status).toBe(403);
    });

    it('rejects MANAGER role from triggering Xero integration with 403', async () => {
      const res = await request(app)
        .post(`/api/export/integrations/xero/${finalizedEntryAId}`)
        .set('Authorization', `Bearer ${managerAToken}`);
      expect(res.status).toBe(403);
    });

    it('allows FINANCE role to access export endpoints', async () => {
      const res = await request(app)
        .get('/api/export/integrations')
        .set('Authorization', `Bearer ${financeAToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.providers)).toBe(true);
    });
  });

  // =========================================================================
  // 2. TENANT ISOLATION
  // =========================================================================
  describe('Multi-Tenant Isolation', () => {
    it('prevents Tenant A Finance from exporting Tenant B journal entry CSV (returns 404)', async () => {
      const res = await request(app)
        .get(`/api/export/journal-entries/${finalizedEntryBId}/csv`)
        .set('Authorization', `Bearer ${financeAToken}`);
      expect(res.status).toBe(404);
    });

    it('prevents Tenant A Finance from exporting Tenant B batch CSV (returns 404)', async () => {
      const res = await request(app)
        .get(`/api/export/finance-batches/${reviewedBatchBId}/csv`)
        .set('Authorization', `Bearer ${financeAToken}`);
      expect(res.status).toBe(404);
    });

    it('prevents Tenant A Finance from executing QuickBooks integration on Tenant B entry (returns 404)', async () => {
      const res = await request(app)
        .post(`/api/export/integrations/quickbooks/${finalizedEntryBId}`)
        .set('Authorization', `Bearer ${financeAToken}`);
      expect(res.status).toBe(404);
    });

    it('tenant-wide CSV export strictly isolates records to authenticated tenant', async () => {
      const resA = await request(app)
        .get('/api/export/csv')
        .set('Authorization', `Bearer ${financeAToken}`);
      expect(resA.status).toBe(200);
      const csvA = resA.text;

      // Must include Tenant A's entry ID and batch ID, but NEVER Tenant B's
      expect(csvA).toContain(finalizedEntryAId);
      expect(csvA).toContain(reviewedBatchAId);
      expect(csvA).not.toContain(finalizedEntryBId);
      expect(csvA).not.toContain(reviewedBatchBId);
    });
  });

  // =========================================================================
  // 3. CSV EXPORT — SOURCE & ELIGIBILITY
  // =========================================================================
  describe('CSV Export — Source & Eligibility', () => {
    it('rejects CSV export for unfinalized DRAFT journal entry with 400', async () => {
      const res = await request(app)
        .get(`/api/export/journal-entries/${draftEntryAId}/csv`)
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/Cannot export unfinalized journal entry/i);
    });

    it('rejects CSV export for batch with unfinalized or missing journal entry with 400', async () => {
      const res = await request(app)
        .get(`/api/export/finance-batches/${openBatchAId}/csv`)
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/No journal entry found|Cannot export unfinalized/i);
    });

    it('successfully exports finalized journal entry as valid CSV with correct headers', async () => {
      const res = await request(app)
        .get(`/api/export/journal-entries/${finalizedEntryAId}/csv`)
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain(`journal-entry-${finalizedEntryAId.substring(0, 8)}.csv`);

      const lines = res.text.trim().split(/\r?\n/);
      expect(lines.length).toBeGreaterThan(1);

      // Verify header row
      const expectedHeader = 'journal_entry_id,finance_batch_id,line_order,account,debit_amount,credit_amount,description,receipt_id,entry_date';
      expect(lines[0]).toBe(expectedHeader);

      // Verify data rows contain expected accounts and values
      expect(res.text).toContain('6100 - Meals & Entertainment');
      expect(res.text).toContain('6200 - Travel & Lodging');
      expect(res.text).toContain('2000 - Accounts Payable');
      expect(res.text).toContain('50.00');
      expect(res.text).toContain('150.00');
    });

    it('successfully exports batch-associated finalized journal entry via /api/export/finance-batches/:id/csv', async () => {
      const res = await request(app)
        .get(`/api/export/finance-batches/${reviewedBatchAId}/csv`)
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text).toContain(finalizedEntryAId);
      expect(res.text).toContain(reviewedBatchAId);
    });

    it('handles empty dataset gracefully (empty tenant returns headers only)', async () => {
      const res = await request(app)
        .get('/api/export/csv')
        .set('Authorization', `Bearer ${financeEmptyToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      const lines = res.text.trim().split(/\r?\n/);
      expect(lines.length).toBe(1); // Header only
      expect(lines[0]).toBe('journal_entry_id,finance_batch_id,line_order,account,debit_amount,credit_amount,description,receipt_id,entry_date');
    });
  });

  // =========================================================================
  // 4. CSV SECURITY & SERIALIZATION
  // =========================================================================
  describe('CSV Formatting & Security (Formula Injection & Escaping)', () => {
    it('escapes commas, quotes, and newlines properly per RFC 4180', async () => {
      const { sanitizeFormulaInjection, escapeCsvCell } = require('../src/services/csvExportService');

      // 1. Commas wrapped in quotes
      expect(escapeCsvCell('Meals, Dinners and Snacks')).toBe('"Meals, Dinners and Snacks"');

      // 2. Double quotes escaped as double double quotes
      expect(escapeCsvCell('Client "VIP" Dinner')).toBe('"Client ""VIP"" Dinner"');

      // 3. Newlines wrapped in quotes
      expect(escapeCsvCell("Line 1\nLine 2")).toBe('"Line 1\nLine 2"');
    });

    it('neutralizes spreadsheet formula injection characters (=, +, -, @)', () => {
      const { sanitizeFormulaInjection, escapeCsvCell } = require('../src/services/csvExportService');

      // Starts with formula operators
      expect(sanitizeFormulaInjection('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
      expect(sanitizeFormulaInjection('+cmd|’ /C calc’!A0')).toBe("'+cmd|’ /C calc’!A0");
      expect(sanitizeFormulaInjection('-2+3+cmd|’ /C calc’!A0')).toBe("'-2+3+cmd|’ /C calc’!A0");
      expect(sanitizeFormulaInjection('@dangerous')).toBe("'@dangerous");

      // Safe alphanumeric string unchanged
      expect(sanitizeFormulaInjection('Normal Description')).toBe('Normal Description');
      expect(sanitizeFormulaInjection('6000 - Meals')).toBe('6000 - Meals');
    });

    it('export does NOT mutate underlying accounting data (read-only)', async () => {
      // Get entry before export
      const beforeEntry = await journalEntryService.getJournalEntryById(tenantAId, finalizedEntryAId);

      // Perform CSV export
      await request(app)
        .get(`/api/export/journal-entries/${finalizedEntryAId}/csv`)
        .set('Authorization', `Bearer ${financeAToken}`);

      // Get entry after export
      const afterEntry = await journalEntryService.getJournalEntryById(tenantAId, finalizedEntryAId);

      expect(afterEntry.status).toBe(beforeEntry.status);
      expect(afterEntry.totalDebit).toBe(beforeEntry.totalDebit);
      expect(afterEntry.totalCredit).toBe(beforeEntry.totalCredit);
      expect(afterEntry.lineCount).toBe(beforeEntry.lineCount);
      expect(new Date(afterEntry.finalizedAt).toISOString()).toBe(new Date(beforeEntry.finalizedAt).toISOString());
    });
  });

  // =========================================================================
  // 5. QUICKBOOKS INTEGRATION POINT
  // =========================================================================
  describe('QuickBooks Integration Point', () => {
    it('rejects unfinalized DRAFT journal entry transformation with 400', async () => {
      const res = await request(app)
        .post(`/api/export/integrations/quickbooks/${draftEntryAId}`)
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/Cannot export unfinalized journal entry to QuickBooks/i);
    });

    it('transforms finalized journal entry into QuickBooks JournalEntry schema', async () => {
      const res = await request(app)
        .post(`/api/export/integrations/quickbooks/${finalizedEntryAId}`)
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.provider).toBe('QuickBooks');
      expect(res.body.status).toBe('INTEGRATION_POINT_READY');
      expect(res.body.totalAmount).toBe(200.00);

      const qbPayload = res.body.payload;
      expect(qbPayload.DocNumber).toBe(`JE-${finalizedEntryAId.substring(0, 8).toUpperCase()}`);
      expect(qbPayload.TxnDate).toBeDefined();
      expect(Array.isArray(qbPayload.Line)).toBe(true);
      expect(qbPayload.Line.length).toBe(4); // 2 debits + 2 credits

      // Verify line structure
      const debitLines = qbPayload.Line.filter((l) => l.JournalEntryLineDetail.PostingType === 'Debit');
      const creditLines = qbPayload.Line.filter((l) => l.JournalEntryLineDetail.PostingType === 'Credit');

      expect(debitLines.length).toBe(2);
      expect(creditLines.length).toBe(2);

      const totalDebits = debitLines.reduce((sum, l) => sum + l.Amount, 0);
      const totalCredits = creditLines.reduce((sum, l) => sum + l.Amount, 0);
      expect(totalDebits).toBe(200.00);
      expect(totalCredits).toBe(200.00);
    });

    it('does not mutate accounting data on QuickBooks transformation', async () => {
      const entry = await journalEntryService.getJournalEntryById(tenantAId, finalizedEntryAId);
      expect(entry.status).toBe('FINALIZED');
      expect(entry.totalDebit).toBe(200.00);
    });
  });

  // =========================================================================
  // 6. XERO INTEGRATION POINT
  // =========================================================================
  describe('Xero Integration Point', () => {
    it('rejects unfinalized DRAFT journal entry transformation with 400', async () => {
      const res = await request(app)
        .post(`/api/export/integrations/xero/${draftEntryAId}`)
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/Cannot export unfinalized journal entry to Xero/i);
    });

    it('transforms finalized journal entry into Xero ManualJournals schema', async () => {
      const res = await request(app)
        .post(`/api/export/integrations/xero/${finalizedEntryAId}`)
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.provider).toBe('Xero');
      expect(res.body.status).toBe('INTEGRATION_POINT_READY');

      const xeroPayload = res.body.payload;
      expect(xeroPayload.ManualJournalID).toBe(`XERO-JE-${finalizedEntryAId.substring(0, 8).toUpperCase()}`);
      expect(xeroPayload.Status).toBe('POSTED');
      expect(Array.isArray(xeroPayload.JournalLines)).toBe(true);
      expect(xeroPayload.JournalLines.length).toBe(4);

      // Verify in Xero ManualJournals: debits are positive, credits are negative
      const debitLines = xeroPayload.JournalLines.filter((l) => l.LineAmount > 0);
      const creditLines = xeroPayload.JournalLines.filter((l) => l.LineAmount < 0);

      expect(debitLines.length).toBe(2);
      expect(creditLines.length).toBe(2);

      // In Xero, the sum of all LineAmounts must balance to 0.00
      const netSum = xeroPayload.JournalLines.reduce((sum, l) => sum + l.LineAmount, 0);
      expect(Math.abs(netSum)).toBeLessThan(0.001);
    });
  });

  // =========================================================================
  // 7. EXPORT AUDIT TRAIL
  // =========================================================================
  describe('Export & Integration Audit Trail', () => {
    it('records append-only audit entries for CSV, QuickBooks, and Xero actions', async () => {
      const res = await request(app)
        .get('/api/export/audit-logs')
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.auditLogs)).toBe(true);

      const logs = res.body.auditLogs;
      expect(logs.length).toBeGreaterThanOrEqual(3);

      const types = logs.map((l) => l.exportType);
      expect(types).toContain('CSV');
      expect(types).toContain('QUICKBOOKS');
      expect(types).toContain('XERO');

      // Check fields: actorId, actorRole, resourceType, recordCount, details, createdAt
      const firstLog = logs[0];
      expect(firstLog.tenantId).toBe(tenantAId);
      expect(firstLog.actorId).toBe(financeAId);
      expect(firstLog.actorRole).toBe('FINANCE');
      expect(firstLog.createdAt).toBeDefined();
      expect(firstLog.recordCount).toBeGreaterThan(0);
      expect(firstLog.details).toBeDefined();
    });

    it('isolates audit logs by tenant', async () => {
      const resB = await request(app)
        .get('/api/export/audit-logs')
        .set('Authorization', `Bearer ${financeBToken}`);

      expect(resB.status).toBe(200);
      for (const log of resB.body.auditLogs) {
        expect(log.tenantId).toBe(tenantBId);
      }
    });
  });
});
