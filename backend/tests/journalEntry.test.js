const request = require('supertest');
const app = require('../src/app');
const { pool, withTenantContext } = require('../src/config/db');
const authService = require('../src/services/authService');
const storageService = require('../src/services/storageService');
const accountMappingService = require('../src/services/accountMappingService');

describe('Checkpoint 8 — Journal Entries / Deterministic Accounting Integration Tests', () => {
  let tenantAId, tenantBId;
  let employeeAId, employeeAToken;
  let managerAId, managerAToken;
  let financeAId, financeAToken;
  let financeBId, financeBToken;

  let receiptMealsId, receiptTravelId, receiptCustomId;
  let openBatchId, reviewedBatchId, reviewedBatchBId;

  beforeAll(async () => {
    // 1. Setup tenants
    const slugA = `accounting-corp-${Date.now()}`;
    const slugB = `other-ledger-${Date.now()}`;

    const tA = await pool.query(
      "INSERT INTO tenants (name, slug) VALUES ('Accounting Corp', $1) RETURNING id",
      [slugA]
    );
    tenantAId = tA.rows[0].id;

    const tB = await pool.query(
      "INSERT INTO tenants (name, slug) VALUES ('Other Ledger', $1) RETURNING id",
      [slugB]
    );
    tenantBId = tB.rows[0].id;

    // 2. Setup users in Tenant A
    await withTenantContext(tenantAId, async (client) => {
      const uEmp = await client.query(
        "INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role) VALUES ($1, $2, 'hash', 'Emp', 'A', 'EMPLOYEE') RETURNING id",
        [tenantAId, `emp.a.${Date.now()}@acct.test`]
      );
      employeeAId = uEmp.rows[0].id;

      const uMgr = await client.query(
        "INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role) VALUES ($1, $2, 'hash', 'Mgr', 'A', 'MANAGER') RETURNING id",
        [tenantAId, `mgr.a.${Date.now()}@acct.test`]
      );
      managerAId = uMgr.rows[0].id;

      const uFin = await client.query(
        "INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role) VALUES ($1, $2, 'hash', 'Fin', 'A', 'FINANCE') RETURNING id",
        [tenantAId, `fin.a.${Date.now()}@acct.test`]
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

    // Sign tokens
    employeeAToken = authService.signToken({ sub: employeeAId, tid: tenantAId, role: 'EMPLOYEE' });
    managerAToken = authService.signToken({ sub: managerAId, tid: tenantAId, role: 'MANAGER' });
    financeAToken = authService.signToken({ sub: financeAId, tid: tenantAId, role: 'FINANCE' });
    financeBToken = authService.signToken({ sub: financeBId, tid: tenantBId, role: 'FINANCE' });

    // 4. Seed default account mappings for Tenant A
    await accountMappingService.seedDefaultAccountMappings(tenantAId);
    await accountMappingService.seedDefaultAccountMappings(tenantBId);

    // 5. Helper to create receipt in APPROVED state with category
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

    receiptMealsId = await createApprovedReceipt(tenantAId, employeeAId, 45.50, 'Meals', 'Bistro Cafe');
    receiptTravelId = await createApprovedReceipt(tenantAId, employeeAId, 120.00, 'Travel', 'Sky Airlines');
    receiptCustomId = await createApprovedReceipt(tenantAId, employeeAId, 250.00, 'UnmappedCategory', 'Custom Vendor');

    const receiptTenantBId = await createApprovedReceipt(tenantBId, financeBId, 80.00, 'Meals', 'Tenant B Diner');

    // 6. Helper to create a Finance Batch directly
    async function createBatchWithState(tenantId, userId, receiptIds, status = 'OPEN') {
      const createRes = await request(app)
        .post('/api/finance-batches')
        .set('Authorization', `Bearer ${tenantId === tenantAId ? financeAToken : financeBToken}`)
        .send({ receiptIds });

      const batchId = createRes.body.batch.id;

      if (status === 'REVIEWED') {
        await request(app)
          .post(`/api/finance-batches/${batchId}/review`)
          .set('Authorization', `Bearer ${tenantId === tenantAId ? financeAToken : financeBToken}`);
      }

      return batchId;
    }

    openBatchId = await createBatchWithState(tenantAId, financeAId, [receiptMealsId], 'OPEN');
    reviewedBatchId = await createBatchWithState(tenantAId, financeAId, [receiptMealsId, receiptTravelId], 'REVIEWED');
    reviewedBatchBId = await createBatchWithState(tenantBId, financeBId, [receiptTenantBId], 'REVIEWED');
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('1. Role-Based Access Control (RBAC)', () => {
    it('should reject unauthenticated requests to journal entries with 401', async () => {
      const res = await request(app).get('/api/journal-entries');
      expect(res.status).toBe(401);
    });

    it('should reject unauthenticated requests to account mappings with 401', async () => {
      const res = await request(app).get('/api/account-mappings');
      expect(res.status).toBe(401);
    });

    it('should forbid EMPLOYEE role from accessing journal entries with 403', async () => {
      const res = await request(app)
        .get('/api/journal-entries')
        .set('Authorization', `Bearer ${employeeAToken}`);
      expect(res.status).toBe(403);
    });

    it('should forbid MANAGER role from accessing journal entries with 403', async () => {
      const res = await request(app)
        .get('/api/journal-entries')
        .set('Authorization', `Bearer ${managerAToken}`);
      expect(res.status).toBe(403);
    });

    it('should permit FINANCE role to access journal entries and account mappings', async () => {
      const resJe = await request(app)
        .get('/api/journal-entries')
        .set('Authorization', `Bearer ${financeAToken}`);
      expect(resJe.status).toBe(200);
      expect(Array.isArray(resJe.body.journalEntries)).toBe(true);

      const resAm = await request(app)
        .get('/api/account-mappings')
        .set('Authorization', `Bearer ${financeAToken}`);
      expect(resAm.status).toBe(200);
      expect(Array.isArray(resAm.body.mappings)).toBe(true);
    });
  });

  describe('2. Account Mappings Management', () => {
    it('should list default account mappings for the tenant', async () => {
      const res = await request(app)
        .get('/api/account-mappings')
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(res.status).toBe(200);
      const categories = res.body.mappings.map((m) => m.category);
      expect(categories).toContain('Meals');
      expect(categories).toContain('Travel');
      expect(categories).toContain('Supplies');
    });

    it('should create or update an account mapping for a category', async () => {
      const res = await request(app)
        .post('/api/account-mappings')
        .set('Authorization', `Bearer ${financeAToken}`)
        .send({
          category: 'Conferences',
          debitAccount: '6500 - Conferences & Training',
          creditAccount: '2000 - Accounts Payable',
        });

      expect(res.status).toBe(200);
      expect(res.body.mapping.category).toBe('Conferences');
      expect(res.body.mapping.debitAccount).toBe('6500 - Conferences & Training');
      expect(res.body.mapping.creditAccount).toBe('2000 - Accounts Payable');
    });

    it('should reject invalid account mapping inputs with 400', async () => {
      const res = await request(app)
        .post('/api/account-mappings')
        .set('Authorization', `Bearer ${financeAToken}`)
        .send({
          category: '',
          debitAccount: '6500 - Conferences',
          creditAccount: '',
        });

      expect(res.status).toBe(400);
    });
  });

  describe('3. Journal Entry Generation Eligibility & Prerequisites', () => {
    it('should reject generating journal entry for non-existent Finance Batch with 404', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .post('/api/journal-entries/generate')
        .set('Authorization', `Bearer ${financeAToken}`)
        .send({ batchId: fakeId });

      expect(res.status).toBe(404);
      expect(res.body.error.message).toMatch(/Finance batch not found/);
    });

    it('should reject generating journal entry for an OPEN (unreviewed) Finance Batch with 400', async () => {
      const res = await request(app)
        .post('/api/journal-entries/generate')
        .set('Authorization', `Bearer ${financeAToken}`)
        .send({ batchId: openBatchId });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/Finance Batch status is 'OPEN'/);
      expect(res.body.error.message).toMatch(/must complete Finance Review/);
    });

    it('should reject generating journal entry if any receipt category lacks an account mapping', async () => {
      // Create a reviewed batch with receiptCustomId ('UnmappedCategory')
      const unmappedBatchRes = await request(app)
        .post('/api/finance-batches')
        .set('Authorization', `Bearer ${financeAToken}`)
        .send({ receiptIds: [receiptCustomId] });
      const unmappedBatchId = unmappedBatchRes.body.batch.id;

      await request(app)
        .post(`/api/finance-batches/${unmappedBatchId}/review`)
        .set('Authorization', `Bearer ${financeAToken}`);

      const res = await request(app)
        .post('/api/journal-entries/generate')
        .set('Authorization', `Bearer ${financeAToken}`)
        .send({ batchId: unmappedBatchId });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/Missing account mapping for category: 'UnmappedCategory'/);
    });
  });

  describe('4. Successful Journal Entry Generation & Deterministic Double-Entry Lines', () => {
    let generatedEntryId;

    it('should successfully generate a balanced journal entry from a REVIEWED Finance Batch', async () => {
      const res = await request(app)
        .post(`/api/finance-batches/${reviewedBatchId}/journal-entry`)
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const entry = res.body.journalEntry;
      generatedEntryId = entry.id;

      expect(entry.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(entry.batchId).toBe(reviewedBatchId);
      expect(entry.status).toBe('DRAFT');
      expect(entry.createdBy.id).toBe(financeAId);

      // $45.50 (Meals) + $120.00 (Travel) = $165.50
      expect(entry.totalDebit).toBe(165.50);
      expect(entry.totalCredit).toBe(165.50);
      expect(entry.isBalanced).toBe(true);

      // 2 expenses * 2 lines each (1 debit, 1 credit) = 4 lines
      expect(entry.lineCount).toBe(4);
      expect(entry.lines).toHaveLength(4);

      // Verify line details & deterministic order
      const mealsDebit = entry.lines.find(
        (l) => l.account === '6100 - Meals & Entertainment' && l.debitAmount === 45.50
      );
      expect(mealsDebit).toBeDefined();
      expect(mealsDebit.creditAmount).toBe(0.00);

      const mealsCredit = entry.lines.find(
        (l) => l.account === '2000 - Accounts Payable' && l.creditAmount === 45.50
      );
      expect(mealsCredit).toBeDefined();
      expect(mealsCredit.debitAmount).toBe(0.00);

      const travelDebit = entry.lines.find(
        (l) => l.account === '6200 - Travel & Lodging' && l.debitAmount === 120.00
      );
      expect(travelDebit).toBeDefined();

      const travelCredit = entry.lines.find(
        (l) => l.account === '2000 - Accounts Payable' && l.creditAmount === 120.00
      );
      expect(travelCredit).toBeDefined();

      // Verify GENERATE in audit trail
      expect(entry.auditHistory).toHaveLength(1);
      expect(entry.auditHistory[0].action).toBe('GENERATE');
      expect(entry.auditHistory[0].actorRole).toBe('FINANCE');
    });

    it('should reject duplicate journal entry generation for the same Finance Batch with 400', async () => {
      const res = await request(app)
        .post('/api/journal-entries/generate')
        .set('Authorization', `Bearer ${financeAToken}`)
        .send({ batchId: reviewedBatchId });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/A journal entry already exists for Finance Batch/);
    });

    it('should retrieve journal entry details by ID', async () => {
      const res = await request(app)
        .get(`/api/journal-entries/${generatedEntryId}`)
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.journalEntry.id).toBe(generatedEntryId);
      expect(res.body.journalEntry.lines).toHaveLength(4);
    });

    it('should retrieve journal entry by Finance Batch ID', async () => {
      const res = await request(app)
        .get(`/api/finance-batches/${reviewedBatchId}/journal-entry`)
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.journalEntry.id).toBe(generatedEntryId);
      expect(res.body.journalEntry.batchId).toBe(reviewedBatchId);
    });
  });

  describe('5. Double-Entry Balance Validation & Finalization', () => {
    let entryToFinalizeId;

    beforeAll(async () => {
      // Find the draft journal entry from section 4
      const listRes = await request(app)
        .get('/api/journal-entries')
        .set('Authorization', `Bearer ${financeAToken}`);

      const entry = listRes.body.journalEntries.find((e) => e.batchId === reviewedBatchId);
      entryToFinalizeId = entry.id;
    });

    it('should reject finalization if an unbalanced journal entry is detected', async () => {
      // Create a temporary mock unbalanced entry in database within tenant context
      let unbalancedEntryId;
      await withTenantContext(tenantAId, async (client) => {
        const dummyBatch = await client.query(
          `INSERT INTO finance_batches (tenant_id, created_by, status, total_amount, expense_count)
           VALUES ($1, $2, 'REVIEWED', 100.00, 1) RETURNING id`,
          [tenantAId, financeAId]
        );
        const bId = dummyBatch.rows[0].id;

        const jeRes = await client.query(
          `INSERT INTO journal_entries (tenant_id, batch_id, created_by, status, total_debit, total_credit, line_count)
           VALUES ($1, $2, $3, 'DRAFT', 100.00, 99.99, 2) RETURNING id`,
          [tenantAId, bId, financeAId]
        );
        unbalancedEntryId = jeRes.rows[0].id;

        // Add unbalanced lines: Debit 100.00 vs Credit 99.99
        await client.query(
          `INSERT INTO journal_entry_lines (journal_entry_id, tenant_id, line_order, account, debit_amount, credit_amount)
           VALUES ($1, $2, 1, '6100 - Meals', 100.00, 0.00),
                  ($1, $2, 2, '2000 - Payable', 0.00, 99.99)`,
          [unbalancedEntryId, tenantAId]
        );
      });

      const res = await request(app)
        .post(`/api/journal-entries/${unbalancedEntryId}/finalize`)
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/Double-entry validation failed: Total debits .* must equal total credits/);
      expect(res.body.error.message).toMatch(/Unbalanced journal entries cannot be finalized/);
    });

    it('should successfully finalize a balanced journal entry', async () => {
      const res = await request(app)
        .post(`/api/journal-entries/${entryToFinalizeId}/finalize`)
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const entry = res.body.journalEntry;
      expect(entry.status).toBe('FINALIZED');
      expect(entry.finalizedBy.id).toBe(financeAId);
      expect(entry.finalizedAt).toBeTruthy();
      expect(entry.isBalanced).toBe(true);

      // Verify FINALIZE in audit trail
      const actions = entry.auditHistory.map((a) => a.action);
      expect(actions).toContain('FINALIZE');
    });

    it('should reject re-finalizing an already FINALIZED journal entry with 400', async () => {
      const res = await request(app)
        .post(`/api/journal-entries/${entryToFinalizeId}/finalize`)
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/already been finalized/);
    });
  });

  describe('6. Multi-Tenancy & Tenant Isolation (RLS)', () => {
    it('should forbid Tenant A from generating journal entry for Tenant B Finance Batch (RLS isolation -> 404)', async () => {
      const res = await request(app)
        .post('/api/journal-entries/generate')
        .set('Authorization', `Bearer ${financeAToken}`)
        .send({ batchId: reviewedBatchBId });

      expect(res.status).toBe(404);
      expect(res.body.error.message).toMatch(/Finance batch not found/);
    });

    it('should forbid Tenant B from viewing Tenant A journal entry (RLS isolation -> 404)', async () => {
      // Find Tenant A journal entry
      const listA = await request(app)
        .get('/api/journal-entries')
        .set('Authorization', `Bearer ${financeAToken}`);

      const entryAId = listA.body.journalEntries[0].id;

      // Tenant B attempts to retrieve it
      const res = await request(app)
        .get(`/api/journal-entries/${entryAId}`)
        .set('Authorization', `Bearer ${financeBToken}`);

      expect(res.status).toBe(404);
    });

    it('should forbid Tenant B from finalizing Tenant A journal entry (RLS isolation -> 404)', async () => {
      const listA = await request(app)
        .get('/api/journal-entries')
        .set('Authorization', `Bearer ${financeAToken}`);

      const entryAId = listA.body.journalEntries[0].id;

      const res = await request(app)
        .post(`/api/journal-entries/${entryAId}/finalize`)
        .set('Authorization', `Bearer ${financeBToken}`);

      expect(res.status).toBe(404);
    });
  });
});
