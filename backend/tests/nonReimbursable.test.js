const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const { pool, withTransaction, withTenantContext } = require('../src/config/db');
const { runMigrations } = require('../../database/migrator');
const authService = require('../src/services/authService');
const financeBatchService = require('../src/services/financeBatchService');
const reimbursementService = require('../src/services/reimbursementService');
const journalEntryService = require('../src/services/journalEntryService');

describe('Feature A & C: Other Account Mapping & Non-Reimbursable Bills', () => {
  let tenantAId, tenantASlug;
  let tenantBId, tenantBSlug;
  let employeeAToken, managerAToken, financeAToken, financeBToken;
  let employeeAId, managerAId, financeAId;
  const rawPassword = 'NonReimbSecurePassword123!';

  const dummyImage = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );

  beforeAll(async () => {
    await runMigrations(pool);

    const hashedPwd = await authService.hashPassword(rawPassword);
    tenantASlug = `nonreimb-tenant-a-${Date.now()}`;
    tenantBSlug = `nonreimb-tenant-b-${Date.now()}`;

    await withTransaction(async (client) => {
      // 1. Create Tenant A
      const resA = await client.query(
        `INSERT INTO tenants (name, slug, status) VALUES ('Delta Operations Corp', $1, 'ACTIVE') RETURNING id`,
        [tenantASlug]
      );
      tenantAId = resA.rows[0].id;

      // 2. Create Tenant B
      const resB = await client.query(
        `INSERT INTO tenants (name, slug, status) VALUES ('Epsilon Corp', $1, 'ACTIVE') RETURNING id`,
        [tenantBSlug]
      );
      tenantBId = resB.rows[0].id;

      // 3. Tenant A users
      const empA = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, 'Dana', 'Employee', 'EMPLOYEE') RETURNING id`,
        [tenantAId, `dana.${Date.now()}@delta.com`, hashedPwd]
      );
      employeeAId = empA.rows[0].id;

      const mgrA = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, 'Mark', 'Manager', 'MANAGER') RETURNING id`,
        [tenantAId, `mark.${Date.now()}@delta.com`, hashedPwd]
      );
      managerAId = mgrA.rows[0].id;

      const finA = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, 'Fiona', 'Finance', 'FINANCE') RETURNING id`,
        [tenantAId, `fiona.${Date.now()}@delta.com`, hashedPwd]
      );
      financeAId = finA.rows[0].id;

      // 4. Tenant B users
      await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, 'Fred', 'FinanceB', 'FINANCE') RETURNING id`,
        [tenantBId, `fred.${Date.now()}@epsilon.com`, hashedPwd]
      );
    });

    const loginEmpA = await authService.login({
      tenantSlug: tenantASlug,
      email: (await pool.query('SELECT email FROM users WHERE id = $1', [employeeAId])).rows[0].email,
      password: rawPassword,
    });
    employeeAToken = loginEmpA.token;

    const loginMgrA = await authService.login({
      tenantSlug: tenantASlug,
      email: (await pool.query('SELECT email FROM users WHERE id = $1', [managerAId])).rows[0].email,
      password: rawPassword,
    });
    managerAToken = loginMgrA.token;

    const loginFinA = await authService.login({
      tenantSlug: tenantASlug,
      email: (await pool.query('SELECT email FROM users WHERE id = $1', [financeAId])).rows[0].email,
      password: rawPassword,
    });
    financeAToken = loginFinA.token;

    const finBRow = (await pool.query("SELECT email FROM users WHERE tenant_id = $1 AND role = 'FINANCE'", [tenantBId])).rows[0];
    const loginFinB = await authService.login({
      tenantSlug: tenantBSlug,
      email: finBRow.email,
      password: rawPassword,
    });
    financeBToken = loginFinB.token;
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('Feature A: "Other" Account Mapping & Safe Missing Mapping Failures', () => {
    it('verifies default mapping exists for category "Other"', async () => {
      const res = await request(app)
        .get('/api/account-mappings')
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(res.status).toBe(200);
      const otherMapping = res.body.mappings.find((m) => m.category.toLowerCase() === 'other');
      expect(otherMapping).toBeDefined();
      expect(otherMapping.debitAccount).toBe('6900 - Miscellaneous / Other Expense');
      expect(otherMapping.creditAccount).toBe('2000 - Accounts Payable');
    });

    it('generates a balanced journal entry for a batch containing "Other" category receipts', async () => {
      // 1. Create and approve a receipt categorized as 'Other'
      let receiptId;
      await withTransaction(async (client) => {
        const rRes = await client.query(
          `INSERT INTO receipts (
            tenant_id, uploaded_by, original_filename, mime_type, file_size_bytes, storage_key, upload_status, ocr_status, claim_type
          ) VALUES ($1, $2, 'miscellaneous_bill.png', 'image/png', 1024, 'dummy_key_' || $3, 'COMPLETED', 'COMPLETED', 'REIMBURSEMENT')
          RETURNING id`,
          [tenantAId, employeeAId, crypto.randomUUID()]
        );
        receiptId = rRes.rows[0].id;

        await client.query(
          `INSERT INTO expense_workflows (
            tenant_id, receipt_id, submitted_by, current_state, claim_type, submitted_at, completed_at
          ) VALUES ($1, $2, $3, 'APPROVED', 'REIMBURSEMENT', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [tenantAId, receiptId, employeeAId]
        );

        await client.query(
          `INSERT INTO receipt_extractions (
            tenant_id, receipt_id, extraction_status, ai_total_amount, confirmed_total_amount,
            ai_suggested_category, confirmed_category, confirmed_merchant_name
          ) VALUES ($1, $2, 'MANUALLY_CONFIRMED', 150.00, 150.00, 'Other', 'Other', 'Misc Services')`,
          [tenantAId, receiptId]
        );
      });

      // 2. Create Finance Batch
      const batchRes = await financeBatchService.createBatch(
        tenantAId,
        financeAId,
        'FINANCE',
        { receiptIds: [receiptId] }
      );
      expect(batchRes).toBeDefined();

      // 3. Review batch
      await financeBatchService.reviewBatch(tenantAId, financeAId, 'FINANCE', batchRes.id);

      // 4. Generate Journal Entry
      const je = await journalEntryService.generateJournalEntry(
        tenantAId,
        financeAId,
        'FINANCE',
        batchRes.id
      );

      expect(je).toBeDefined();
      expect(je.status).toBe('DRAFT');
      expect(Number(je.totalDebit)).toBe(150);
      expect(Number(je.totalCredit)).toBe(150);
      expect(je.isBalanced).toBe(true);

      const debitLine = je.lines.find((l) => Number(l.debitAmount) > 0);
      expect(debitLine.account).toBe('6900 - Miscellaneous / Other Expense');
    });

    it('fails safely with HTTP 400 when generating journal entry for a genuinely unmapped category', async () => {
      let unmappedReceiptId;
      await withTransaction(async (client) => {
        const rRes = await client.query(
          `INSERT INTO receipts (
            tenant_id, uploaded_by, original_filename, mime_type, file_size_bytes, storage_key, upload_status, ocr_status, claim_type
          ) VALUES ($1, $2, 'exotic_bill.png', 'image/png', 1024, 'dummy_key_2_' || $3, 'COMPLETED', 'COMPLETED', 'REIMBURSEMENT')
          RETURNING id`,
          [tenantAId, employeeAId, crypto.randomUUID()]
        );
        unmappedReceiptId = rRes.rows[0].id;

        await client.query(
          `INSERT INTO expense_workflows (
            tenant_id, receipt_id, submitted_by, current_state, claim_type, submitted_at, completed_at
          ) VALUES ($1, $2, $3, 'APPROVED', 'REIMBURSEMENT', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [tenantAId, unmappedReceiptId, employeeAId]
        );

        await client.query(
          `INSERT INTO receipt_extractions (
            tenant_id, receipt_id, extraction_status, ai_total_amount, confirmed_total_amount,
            ai_suggested_category, confirmed_category, confirmed_merchant_name
          ) VALUES ($1, $2, 'MANUALLY_CONFIRMED', 200.00, 200.00, 'ExoticCategory', 'ExoticCategory', 'Exotic Merchant')`,
          [tenantAId, unmappedReceiptId]
        );
      });

      const batch = await financeBatchService.createBatch(
        tenantAId,
        financeAId,
        'FINANCE',
        { receiptIds: [unmappedReceiptId] }
      );
      await financeBatchService.reviewBatch(tenantAId, financeAId, 'FINANCE', batch.id);

      await expect(
        journalEntryService.generateJournalEntry(tenantAId, financeAId, 'FINANCE', batch.id)
      ).rejects.toThrow(/Missing account mapping for category: 'ExoticCategory'/);
    });
  });

  describe('Feature C: Employee & Manager Upload of Non-Reimbursable Bill Photos', () => {
    let nonReimbReceiptId;

    it('allows Employee to upload bill photo marked as NON_REIMBURSABLE with orgReference', async () => {
      const res = await request(app)
        .post('/api/receipts/upload')
        .set('Authorization', `Bearer ${employeeAToken}`)
        .field('claimType', 'NON_REIMBURSABLE')
        .field('orgReference', 'DEPT-ENG-2026')
        .attach('receipt', dummyImage, 'non_reimb_receipt.png');

      expect(res.status).toBe(201);
      expect(res.body.receipt).toBeDefined();
      expect(res.body.receipt.claimType).toBe('NON_REIMBURSABLE');
      expect(res.body.receipt.orgReference).toBe('DEPT-ENG-2026');

      nonReimbReceiptId = res.body.receipt.id;

      // Check database: must have workflow in DOCUMENTED state
      const { rows: wfRows } = await pool.query(
        'SELECT * FROM expense_workflows WHERE receipt_id = $1',
        [nonReimbReceiptId]
      );
      expect(wfRows.length).toBe(1);
      expect(wfRows[0].current_state).toBe('DOCUMENTED');
      expect(wfRows[0].claim_type).toBe('NON_REIMBURSABLE');
      expect(wfRows[0].org_reference).toBe('DEPT-ENG-2026');
    });

    it('allows Manager to also upload non-reimbursable bill photo', async () => {
      const res = await request(app)
        .post('/api/receipts/upload')
        .set('Authorization', `Bearer ${managerAToken}`)
        .field('claimType', 'NON_REIMBURSABLE')
        .field('orgReference', 'MGMT-OFFSITE-01')
        .attach('receipt', dummyImage, 'mgr_non_reimb.png');

      expect(res.status).toBe(201);
      expect(res.body.receipt.claimType).toBe('NON_REIMBURSABLE');
      expect(res.body.receipt.orgReference).toBe('MGMT-OFFSITE-01');
    });

    it('prevents non-reimbursable bill from being submitted for reimbursement approval', async () => {
      const res = await request(app)
        .post(`/api/receipts/${nonReimbReceiptId}/workflow/submit`)
        .set('Authorization', `Bearer ${employeeAToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/cannot submit a non-reimbursable recordkeeping bill/i);
    });

    it('prevents Manager from executing reimbursement approvals on non-reimbursable records', async () => {
      const res = await request(app)
        .post(`/api/receipts/${nonReimbReceiptId}/workflow/approve`)
        .set('Authorization', `Bearer ${managerAToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/non-reimbursable documentation is not subject to manager approvals/i);
    });

    it('excludes non-reimbursable bills from Manager pending approvals queue', async () => {
      const res = await request(app)
        .get('/api/receipts?status=PENDING_APPROVAL')
        .set('Authorization', `Bearer ${managerAToken}`);

      expect(res.status).toBe(200);
      const found = res.body.receipts.find((r) => r.id === nonReimbReceiptId);
      expect(found).toBeUndefined();
    });

    it('strictly excludes non-reimbursable bills from Finance reimbursement calculations and summaries', async () => {
      const summary = await reimbursementService.getReimbursementSummary(tenantAId);
      for (const emp of summary.summaries) {
        const found = emp.claims.find((c) => c.receiptId === nonReimbReceiptId);
        expect(found).toBeUndefined();
      }
    });

    it('strictly excludes non-reimbursable bills from Finance Batches', async () => {
      const eligible = await financeBatchService.getEligibleApprovedExpenses(tenantAId);
      const found = eligible.find((e) => e.receiptId === nonReimbReceiptId);
      expect(found).toBeUndefined();

      // Attempting to create a batch with the non-reimbursable receipt must fail
      await expect(
        financeBatchService.createBatch(tenantAId, financeAId, 'FINANCE', {
          receiptIds: [nonReimbReceiptId],
        })
      ).rejects.toThrow(/Only APPROVED expenses may enter a finance batch/);
    });

    it('allows Finance to discover non-reimbursable records in Organization Expense Ledger and filter by claimType', async () => {
      // 1. Fetch with claimType = NON_REIMBURSABLE
      const res = await request(app)
        .get('/api/finance/expenses?claimType=NON_REIMBURSABLE')
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.receipts.length).toBeGreaterThanOrEqual(1);
      const doc = res.body.receipts.find((r) => r.id === nonReimbReceiptId);
      expect(doc).toBeDefined();
      expect(doc.claimType).toBe('NON_REIMBURSABLE');
      expect(doc.orgReference).toBe('DEPT-ENG-2026');
      expect(doc.workflowState).toBe('DOCUMENTED');

      // 2. Fetch with claimType = REIMBURSEMENT
      const resReimb = await request(app)
        .get('/api/finance/expenses?claimType=REIMBURSEMENT')
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(resReimb.status).toBe(200);
      const foundInReimb = resReimb.body.receipts.find((r) => r.id === nonReimbReceiptId);
      expect(foundInReimb).toBeUndefined();
    });

    it('enforces tenant isolation: Tenant B Finance cannot see Tenant A non-reimbursable records', async () => {
      const resB = await request(app)
        .get('/api/finance/expenses?claimType=NON_REIMBURSABLE')
        .set('Authorization', `Bearer ${financeBToken}`);

      expect(resB.status).toBe(200);
      const crossTenantFound = resB.body.receipts.find((r) => r.id === nonReimbReceiptId);
      expect(crossTenantFound).toBeUndefined();
    });
  });
});
