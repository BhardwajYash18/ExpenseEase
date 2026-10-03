const request = require('supertest');
const app = require('../src/app');
const { pool, withTenantContext } = require('../src/config/db');
const authService = require('../src/services/authService');

describe('Checkpoint 10 — End-to-End Workflow & Security Integration Test', () => {
  let tenantAId, tenantASlug;
  let tenantBId, tenantBSlug;

  let employeeAId, employeeAEmail, employeeAPassword;
  let managerAId, managerAEmail, managerAPassword;
  let financeAId, financeAEmail, financeAPassword;

  let employeeBId, employeeBEmail, employeeBPassword;
  let financeBId, financeBEmail, financeBPassword;

  let employeeAToken, managerAToken, financeAToken;
  let employeeBToken, financeBToken;

  let receiptId;
  let batchId;
  let journalEntryId;

  // Minimal 1x1 valid JPEG
  const validJpegBuffer = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
    0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
    0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
    0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
    0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
    0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00,
    0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
    0x00, 0xbf, 0x00, 0xff, 0xd9,
  ]);

  beforeAll(async () => {
    // 1. Provision Tenants
    tenantASlug = `e2e-acme-${Date.now()}`;
    tenantBSlug = `e2e-rival-${Date.now()}`;

    const tA = await pool.query(
      "INSERT INTO tenants (name, slug) VALUES ('Acme E2E Corp', $1) RETURNING id",
      [tenantASlug]
    );
    tenantAId = tA.rows[0].id;

    const tB = await pool.query(
      "INSERT INTO tenants (name, slug) VALUES ('Rival E2E Corp', $1) RETURNING id",
      [tenantBSlug]
    );
    tenantBId = tB.rows[0].id;

    // 2. Provision Users in Tenant A
    employeeAEmail = `alice.${Date.now()}@acme.test`;
    employeeAPassword = 'Password123!';
    managerAEmail = `bob.mgr.${Date.now()}@acme.test`;
    managerAPassword = 'Password123!';
    financeAEmail = `charlie.fin.${Date.now()}@acme.test`;
    financeAPassword = 'Password123!';

    const hashedPwd = await authService.hashPassword('Password123!');

    await withTenantContext(tenantAId, async (client) => {
      const uEmp = await client.query(
        'INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [tenantAId, employeeAEmail, hashedPwd, 'Alice', 'Employee', 'EMPLOYEE']
      );
      employeeAId = uEmp.rows[0].id;

      const uMgr = await client.query(
        'INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [tenantAId, managerAEmail, hashedPwd, 'Bob', 'Manager', 'MANAGER']
      );
      managerAId = uMgr.rows[0].id;

      const uFin = await client.query(
        'INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [tenantAId, financeAEmail, hashedPwd, 'Charlie', 'Finance', 'FINANCE']
      );
      financeAId = uFin.rows[0].id;

      // Seed GL Account Mappings for Tenant A
      await client.query(
        `INSERT INTO account_mappings (tenant_id, category, debit_account, credit_account)
         VALUES ($1, 'Meals', '6100 - Meals & Entertainment', '2000 - Accounts Payable')
         ON CONFLICT (tenant_id, category) DO NOTHING`,
        [tenantAId]
      );
    });

    // 3. Provision Users in Tenant B
    employeeBEmail = `mallory.${Date.now()}@rival.test`;
    employeeBPassword = 'Password123!';
    financeBEmail = `frank.fin.${Date.now()}@rival.test`;
    financeBPassword = 'Password123!';

    await withTenantContext(tenantBId, async (client) => {
      const uEmpB = await client.query(
        'INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [tenantBId, employeeBEmail, hashedPwd, 'Mallory', 'Attacker', 'EMPLOYEE']
      );
      employeeBId = uEmpB.rows[0].id;

      const uFinB = await client.query(
        'INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [tenantBId, financeBEmail, hashedPwd, 'Frank', 'RivalFinance', 'FINANCE']
      );
      financeBId = uFinB.rows[0].id;
    });
  });

  afterAll(async () => {
    for (const tId of [tenantAId, tenantBId].filter(Boolean)) {
      await withTenantContext(tId, async (client) => {
        await client.query('DELETE FROM export_audit_logs WHERE tenant_id = $1', [tId]);
        await client.query('DELETE FROM journal_entry_actions WHERE tenant_id = $1', [tId]);
        await client.query('DELETE FROM journal_entry_lines WHERE tenant_id = $1', [tId]);
        await client.query('DELETE FROM journal_entries WHERE tenant_id = $1', [tId]);
        await client.query('DELETE FROM finance_batch_actions WHERE tenant_id = $1', [tId]);
        await client.query('DELETE FROM finance_batch_items WHERE tenant_id = $1', [tId]);
        await client.query('DELETE FROM finance_batches WHERE tenant_id = $1', [tId]);
        await client.query('DELETE FROM expense_workflow_actions WHERE tenant_id = $1', [tId]);
        await client.query('DELETE FROM expense_workflows WHERE tenant_id = $1', [tId]);
        await client.query('DELETE FROM receipt_line_items WHERE tenant_id = $1', [tId]);
        await client.query('DELETE FROM receipt_extractions WHERE tenant_id = $1', [tId]);
        await client.query('DELETE FROM receipts WHERE tenant_id = $1', [tId]);
        await client.query('DELETE FROM receipt_duplicate_candidates WHERE tenant_id = $1', [tId]);
        await client.query('DELETE FROM receipt_validation_results WHERE tenant_id = $1', [tId]);
        await client.query('DELETE FROM tenant_policies WHERE tenant_id = $1', [tId]);
        await client.query('DELETE FROM account_mappings WHERE tenant_id = $1', [tId]);
        await client.query('DELETE FROM users WHERE tenant_id = $1', [tId]);
      });
      await pool.query('DELETE FROM tenants WHERE id = $1', [tId]);
    }
  });

  // =========================================================================
  // STEP 1: AUTHENTICATION VIA LOGIN
  // =========================================================================
  it('Step 1: Authenticate users via POST /api/auth/login', async () => {
    // Login Employee A
    const resEmp = await request(app)
      .post('/api/auth/login')
      .send({ email: employeeAEmail, password: employeeAPassword, slug: tenantASlug });
    expect(resEmp.status).toBe(200);
    expect(resEmp.body.token).toBeDefined();
    expect(resEmp.body.user.role).toBe('EMPLOYEE');
    expect(resEmp.body.user.tenantId).toBe(tenantAId);
    employeeAToken = resEmp.body.token;

    // Login Manager A
    const resMgr = await request(app)
      .post('/api/auth/login')
      .send({ email: managerAEmail, password: managerAPassword, slug: tenantASlug });
    expect(resMgr.status).toBe(200);
    expect(resMgr.body.user.role).toBe('MANAGER');
    managerAToken = resMgr.body.token;

    // Login Finance A
    const resFin = await request(app)
      .post('/api/auth/login')
      .send({ email: financeAEmail, password: financeAPassword, slug: tenantASlug });
    expect(resFin.status).toBe(200);
    expect(resFin.body.user.role).toBe('FINANCE');
    financeAToken = resFin.body.token;

    // Login Tenant B users
    const resEmpB = await request(app)
      .post('/api/auth/login')
      .send({ email: employeeBEmail, password: employeeBPassword, slug: tenantBSlug });
    expect(resEmpB.status).toBe(200);
    employeeBToken = resEmpB.body.token;

    const resFinB = await request(app)
      .post('/api/auth/login')
      .send({ email: financeBEmail, password: financeBPassword, slug: tenantBSlug });
    expect(resFinB.status).toBe(200);
    financeBToken = resFinB.body.token;
  });

  // =========================================================================
  // STEP 2: RECEIPT UPLOAD & OCR
  // =========================================================================
  it('Step 2: Employee A uploads receipt via POST /api/receipts/upload', async () => {
    const res = await request(app)
      .post('/api/receipts/upload')
      .set('Authorization', `Bearer ${employeeAToken}`)
      .attach('receipt', validJpegBuffer, { filename: 'lunch_meeting.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(201);
    expect(res.body.receipt).toBeDefined();
    expect(res.body.receipt.id).toBeDefined();
    expect(res.body.receipt.uploadStatus).toBe('COMPLETED');
    receiptId = res.body.receipt.id;

    // Simulate OCR text extraction in DB (within Tenant A context)
    await withTenantContext(tenantAId, async (client) => {
      await client.query(
        `UPDATE receipts
         SET ocr_status = 'COMPLETED',
             ocr_raw_text = 'CLIENT LUNCH\nDATE: 2026-03-15\nTOTAL: $45.50\nCATEGORY: MEALS'
         WHERE id = $1`,
        [receiptId]
      );
    });

    const ocrRes = await request(app)
      .get(`/api/receipts/${receiptId}/ocr`)
      .set('Authorization', `Bearer ${employeeAToken}`);
    expect(ocrRes.status).toBe(200);
    expect(ocrRes.body.ocr.ocrRawText).toContain('CLIENT LUNCH');
  });

  // =========================================================================
  // STEP 3: AI EXTRACTION & HUMAN CONFIRMATION
  // =========================================================================
  it('Step 3: Trigger structured AI extraction and confirm receipt values', async () => {
    // Seed AI extraction record
    await withTenantContext(tenantAId, async (client) => {
      await client.query(
        `INSERT INTO receipt_extractions (
           receipt_id, tenant_id, extraction_status, model_provider, model_name,
           ai_merchant_name, ai_receipt_date, ai_total_amount, ai_suggested_category
         ) VALUES ($1, $2, 'COMPLETED', 'mock', 'mock-v1', 'Client Lunch Cafe', '2026-03-15', 45.50, 'Meals')
         ON CONFLICT (receipt_id) DO NOTHING`,
        [receiptId, tenantAId]
      );
    });

    // Employee confirms values via PUT /api/receipts/:id/extraction
    const putRes = await request(app)
      .put(`/api/receipts/${receiptId}/extraction`)
      .set('Authorization', `Bearer ${employeeAToken}`)
      .send({
        confirmedData: {
          merchantName: 'Client Lunch Cafe',
          receiptDate: '2026-03-15',
          totalAmount: 45.50,
          category: 'Meals',
        },
      });

    expect(putRes.status).toBe(200);
    expect(putRes.body.extraction.effectiveValues.totalAmount).toBe(45.5);
    expect(putRes.body.extraction.effectiveValues.category).toBe('Meals');
  });

  // =========================================================================
  // STEP 4: POLICY VALIDATION
  // =========================================================================
  it('Step 4: Deterministic policy validation via POST /api/receipts/:id/validation', async () => {
    const res = await request(app)
      .post(`/api/receipts/${receiptId}/validation`)
      .set('Authorization', `Bearer ${employeeAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.validation).toBeDefined();
    expect(['PASSED', 'REVIEW_REQUIRED']).toContain(res.body.validation.policy.status);
    expect(res.body.validation.duplicate.score).toBeDefined();
  });

  // =========================================================================
  // STEP 5: WORKFLOW SUBMISSION & CROSS-TENANT ISOLATION CHECK
  // =========================================================================
  it('Step 5: Employee submits expense claim and asserts mid-flight tenant isolation', async () => {
    const res = await request(app)
      .post(`/api/receipts/${receiptId}/workflow/submit`)
      .set('Authorization', `Bearer ${employeeAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.workflow.currentState).toBe('PENDING_APPROVAL');

    // Tenant B attacker attempts to read Tenant A in-flight claim
    const crossRead = await request(app)
      .get(`/api/receipts/${receiptId}/workflow`)
      .set('Authorization', `Bearer ${employeeBToken}`);
    expect(crossRead.status).toBe(404);

    // Tenant B attacker attempts to approve Tenant A expense
    const crossApprove = await request(app)
      .post(`/api/receipts/${receiptId}/workflow/approve`)
      .set('Authorization', `Bearer ${financeBToken}`)
      .send({ comment: 'Illegal approval' });
    expect([403, 404]).toContain(crossApprove.status);
  });

  // =========================================================================
  // STEP 6: MANAGER APPROVAL
  // =========================================================================
  it('Step 6: Manager A approves the expense claim', async () => {
    const res = await request(app)
      .post(`/api/receipts/${receiptId}/workflow/approve`)
      .set('Authorization', `Bearer ${managerAToken}`)
      .send({ comment: 'Approved for client meeting' });

    expect(res.status).toBe(200);
    expect(res.body.workflow.currentState).toBe('APPROVED');
    expect(res.body.workflow.history).toBeDefined();
    const lastAction = res.body.workflow.history[res.body.workflow.history.length - 1];
    expect(lastAction.action).toBe('APPROVE');
    expect(lastAction.actorId).toBe(managerAId);
  });

  // =========================================================================
  // STEP 7: FINANCE BATCH CREATION & ISOLATION
  // =========================================================================
  it('Step 7: Finance A creates Finance Batch containing approved expense', async () => {
    const res = await request(app)
      .post('/api/finance-batches')
      .set('Authorization', `Bearer ${financeAToken}`)
      .send({ receiptIds: [receiptId] });

    expect(res.status).toBe(201);
    expect(res.body.batch).toBeDefined();
    expect(res.body.batch.status).toBe('OPEN');
    expect(res.body.batch.expenseCount).toBe(1);
    expect(res.body.batch.totalAmount).toBe(45.5);
    batchId = res.body.batch.id;

    // Assert Tenant B Finance cannot see or add Tenant A receipt to their batch
    const rivalBatch = await request(app)
      .post('/api/finance-batches')
      .set('Authorization', `Bearer ${financeBToken}`)
      .send({ receiptIds: [receiptId] });
    expect(rivalBatch.status).toBe(400);
    expect(rivalBatch.body.error.message).toMatch(/not found or cross-tenant/i);
  });

  // =========================================================================
  // STEP 8: FINANCE REVIEW
  // =========================================================================
  it('Step 8: Finance A completes review on the Finance Batch', async () => {
    const res = await request(app)
      .post(`/api/finance-batches/${batchId}/review`)
      .set('Authorization', `Bearer ${financeAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.batch.status).toBe('REVIEWED');
    expect(res.body.batch.reviewedBy.id).toBe(financeAId);
  });

  // =========================================================================
  // STEP 9: JOURNAL ENTRY GENERATION & DOUBLE-ENTRY INVARIANT
  // =========================================================================
  it('Step 9: Finance A generates balanced double-entry Journal Entry', async () => {
    const res = await request(app)
      .post('/api/journal-entries/generate')
      .set('Authorization', `Bearer ${financeAToken}`)
      .send({ batchId });

    expect(res.status).toBe(201);
    expect(res.body.journalEntry).toBeDefined();
    expect(res.body.journalEntry.status).toBe('DRAFT');
    expect(res.body.journalEntry.totalDebit).toBe(45.5);
    expect(res.body.journalEntry.totalCredit).toBe(45.5);

    // CRITICAL ACCOUNTING INVARIANT: TOTAL DEBITS = TOTAL CREDITS
    expect(res.body.journalEntry.totalDebit).toBe(res.body.journalEntry.totalCredit);
    journalEntryId = res.body.journalEntry.id;
  });

  // =========================================================================
  // STEP 10: JOURNAL ENTRY FINALIZATION
  // =========================================================================
  it('Step 10: Finance A finalizes the Journal Entry', async () => {
    const res = await request(app)
      .post(`/api/journal-entries/${journalEntryId}/finalize`)
      .set('Authorization', `Bearer ${financeAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.journalEntry.status).toBe('FINALIZED');
    expect(res.body.journalEntry.finalizedBy.id).toBe(financeAId);
  });

  // =========================================================================
  // STEP 11: CSV EXPORT & RFC 4180 COMPLIANCE
  // =========================================================================
  it('Step 11: Finance A exports finalized Journal Entry as CSV', async () => {
    const res = await request(app)
      .get(`/api/export/journal-entries/${journalEntryId}/csv`)
      .set('Authorization', `Bearer ${financeAToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const csv = res.text;

    // Verify CSV structure
    expect(csv).toContain('journal_entry_id,finance_batch_id,line_order,account,debit_amount,credit_amount,description,receipt_id,entry_date');
    expect(csv).toContain(journalEntryId);
    expect(csv).toContain(batchId);
    expect(csv).toContain('6100 - Meals & Entertainment');
    expect(csv).toContain('2000 - Accounts Payable');
    expect(csv).toContain('45.50');
  });

  // =========================================================================
  // STEP 12: CROSS-TENANT EXPORT ISOLATION
  // =========================================================================
  it('Step 12: Tenant B Finance cannot access Tenant A finalized export artifacts', async () => {
    // Attempt single export
    const crossExport = await request(app)
      .get(`/api/export/journal-entries/${journalEntryId}/csv`)
      .set('Authorization', `Bearer ${financeBToken}`);
    expect(crossExport.status).toBe(404);

    // Attempt general export (must contain zero records from Tenant A)
    const generalExport = await request(app)
      .get('/api/export/csv')
      .set('Authorization', `Bearer ${financeBToken}`);
    expect(generalExport.status).toBe(200);
    expect(generalExport.text).not.toContain(journalEntryId);
    expect(generalExport.text).not.toContain(batchId);
  });

  // =========================================================================
  // STEP 13: QUICKBOOKS & XERO INTEGRATION POINT VERIFICATION
  // =========================================================================
  it('Step 13: Transform finalized Journal Entry for QuickBooks and Xero without live network requests', async () => {
    // QuickBooks Adapter
    const qbRes = await request(app)
      .post(`/api/export/integrations/quickbooks/${journalEntryId}`)
      .set('Authorization', `Bearer ${financeAToken}`);
    expect(qbRes.status).toBe(200);
    expect(qbRes.body.success).toBe(true);
    expect(qbRes.body.provider.toLowerCase()).toBe('quickbooks');
    expect(qbRes.body.payload.DocNumber).toBeDefined();
    expect(qbRes.body.payload.Line).toHaveLength(2);

    // Xero Adapter
    const xeroRes = await request(app)
      .post(`/api/export/integrations/xero/${journalEntryId}`)
      .set('Authorization', `Bearer ${financeAToken}`);
    expect(xeroRes.status).toBe(200);
    expect(xeroRes.body.success).toBe(true);
    expect(xeroRes.body.provider.toLowerCase()).toBe('xero');
    expect(xeroRes.body.payload.ManualJournalID).toBeDefined();
    expect(xeroRes.body.payload.JournalLines).toHaveLength(2);
  });
});
