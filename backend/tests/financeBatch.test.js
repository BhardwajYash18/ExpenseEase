const request = require('supertest');
const app = require('../src/app');
const { pool, withTenantContext } = require('../src/config/db');
const authService = require('../src/services/authService');
const storageService = require('../src/services/storageService');

describe('Checkpoint 7 — Finance Batches Integration Tests', () => {
  let tenantAId, tenantBId;
  let employeeAId, employeeAToken;
  let managerAId, managerAToken;
  let financeAId, financeAToken;
  let financeBId, financeBToken;

  let receiptApp1Id, receiptApp2Id, receiptApp3Id;
  let receiptDraftId, receiptPendingId, receiptRejectedId, receiptCorrectionId;
  let receiptTenantBId;

  beforeAll(async () => {
    // 1. Setup tenants
    const slugA = `finance-corp-${Date.now()}`;
    const slugB = `other-corp-${Date.now()}`;

    const tA = await pool.query(
      "INSERT INTO tenants (name, slug) VALUES ('Finance Corp', $1) RETURNING id",
      [slugA]
    );
    tenantAId = tA.rows[0].id;

    const tB = await pool.query(
      "INSERT INTO tenants (name, slug) VALUES ('Other Corp', $1) RETURNING id",
      [slugB]
    );
    tenantBId = tB.rows[0].id;

    // 2. Setup users in Tenant A
    await withTenantContext(tenantAId, async (client) => {
      const uEmp = await client.query(
        "INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role) VALUES ($1, $2, 'hash', 'Emp', 'A', 'EMPLOYEE') RETURNING id",
        [tenantAId, `emp.a.${Date.now()}@finance.test`]
      );
      employeeAId = uEmp.rows[0].id;

      const uMgr = await client.query(
        "INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role) VALUES ($1, $2, 'hash', 'Mgr', 'A', 'MANAGER') RETURNING id",
        [tenantAId, `mgr.a.${Date.now()}@finance.test`]
      );
      managerAId = uMgr.rows[0].id;

      const uFin = await client.query(
        "INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role) VALUES ($1, $2, 'hash', 'Fin', 'A', 'FINANCE') RETURNING id",
        [tenantAId, `fin.a.${Date.now()}@finance.test`]
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

    // 4. Helper to create receipt with workflow state and extraction
    async function createReceiptWithState(tenantId, userId, amount, state, filename = 'receipt.jpg') {
      const key = storageService.generateStorageKey(tenantId, 'image/jpeg');
      await storageService.storeFile(key, Buffer.from(`bytes for ${filename}`));

      return withTenantContext(tenantId, async (client) => {
        const rRes = await client.query(
          `INSERT INTO receipts (
            tenant_id, uploaded_by, original_filename, mime_type, file_size_bytes, storage_key, upload_status, ocr_status, ocr_raw_text
          ) VALUES ($1, $2, $3, 'image/jpeg', 100, $4, 'COMPLETED', 'COMPLETED', $5)
          RETURNING id`,
          [tenantId, userId, filename, key, `RECEIPT TEXT $${amount}`]
        );
        const receiptId = rRes.rows[0].id;

        await client.query(
          `INSERT INTO receipt_extractions (
            receipt_id, tenant_id, extraction_status, ai_merchant_name, ai_receipt_date, ai_total_amount, ai_suggested_category
          ) VALUES ($1, $2, 'COMPLETED', 'Test Vendor', '2026-06-01', $3, 'Meals')`,
          [receiptId, tenantId, amount]
        );

        await client.query(
          `INSERT INTO receipt_validation_results (
            receipt_id, tenant_id, validation_status, validation_version, policy_rules_result, duplicate_status, duplicate_score
          ) VALUES ($1, $2, 'PASSED', 'v1', '[]'::jsonb, 'NO_MATCH', 0.00)`,
          [receiptId, tenantId]
        );

        await client.query(
          `INSERT INTO expense_workflows (
            tenant_id, receipt_id, submitted_by, current_state, submitted_at, completed_at
          ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, ${state === 'APPROVED' ? 'CURRENT_TIMESTAMP' : 'NULL'})`,
          [tenantId, receiptId, userId, state]
        );

        return receiptId;
      });
    }

    // Seed receipts with various states in Tenant A
    receiptApp1Id = await createReceiptWithState(tenantAId, employeeAId, 45.50, 'APPROVED', 'approved1.jpg');
    receiptApp2Id = await createReceiptWithState(tenantAId, employeeAId, 120.00, 'APPROVED', 'approved2.jpg');
    receiptApp3Id = await createReceiptWithState(tenantAId, employeeAId, 30.25, 'APPROVED', 'approved3.jpg');

    receiptDraftId = await createReceiptWithState(tenantAId, employeeAId, 10.00, 'DRAFT', 'draft.jpg');
    receiptPendingId = await createReceiptWithState(tenantAId, employeeAId, 25.00, 'PENDING_APPROVAL', 'pending.jpg');
    receiptRejectedId = await createReceiptWithState(tenantAId, employeeAId, 50.00, 'REJECTED', 'rejected.jpg');
    receiptCorrectionId = await createReceiptWithState(tenantAId, employeeAId, 15.00, 'CORRECTION_REQUESTED', 'correction.jpg');

    // Seed receipt in Tenant B
    receiptTenantBId = await createReceiptWithState(tenantBId, financeBId, 80.00, 'APPROVED', 'tenantB.jpg');
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('1. Role-Based Access Control (RBAC)', () => {
    it('should reject unauthenticated requests with 401', async () => {
      const res = await request(app).get('/api/finance-batches');
      expect(res.status).toBe(401);
    });

    it('should forbid EMPLOYEE role from accessing finance batches with 403', async () => {
      const res = await request(app)
        .get('/api/finance-batches')
        .set('Authorization', `Bearer ${employeeAToken}`);
      expect(res.status).toBe(403);
    });

    it('should forbid MANAGER role from accessing finance batches with 403', async () => {
      const res = await request(app)
        .get('/api/finance-batches')
        .set('Authorization', `Bearer ${managerAToken}`);
      expect(res.status).toBe(403);
    });

    it('should permit FINANCE role to access finance batches', async () => {
      const res = await request(app)
        .get('/api/finance-batches')
        .set('Authorization', `Bearer ${financeAToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.batches)).toBe(true);
    });
  });

  describe('2. Eligible Approved Expenses Query', () => {
    it('should list only APPROVED expenses in the tenant', async () => {
      const res = await request(app)
        .get('/api/finance-batches/eligible-expenses')
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const ids = res.body.expenses.map((e) => e.receiptId);

      // Must include all 3 approved receipts
      expect(ids).toContain(receiptApp1Id);
      expect(ids).toContain(receiptApp2Id);
      expect(ids).toContain(receiptApp3Id);

      // Must NOT include non-approved receipts
      expect(ids).not.toContain(receiptDraftId);
      expect(ids).not.toContain(receiptPendingId);
      expect(ids).not.toContain(receiptRejectedId);
      expect(ids).not.toContain(receiptCorrectionId);

      // Must NOT include Tenant B receipts
      expect(ids).not.toContain(receiptTenantBId);
    });
  });

  describe('3. Eligibility & All-or-Nothing Batch Creation', () => {
    it('should reject batch creation if any expense is in DRAFT state', async () => {
      const res = await request(app)
        .post('/api/finance-batches')
        .set('Authorization', `Bearer ${financeAToken}`)
        .send({
          receiptIds: [receiptApp1Id, receiptDraftId],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/Only APPROVED expenses may enter a finance batch/);
    });

    it('should reject batch creation if any expense is in PENDING_APPROVAL state', async () => {
      const res = await request(app)
        .post('/api/finance-batches')
        .set('Authorization', `Bearer ${financeAToken}`)
        .send({
          receiptIds: [receiptPendingId],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/Only APPROVED expenses may enter a finance batch/);
    });

    it('should reject batch creation if any expense is in REJECTED state', async () => {
      const res = await request(app)
        .post('/api/finance-batches')
        .set('Authorization', `Bearer ${financeAToken}`)
        .send({
          receiptIds: [receiptApp1Id, receiptRejectedId],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/Only APPROVED expenses may enter a finance batch/);
    });

    it('should reject batch creation if any expense is in CORRECTION_REQUESTED state', async () => {
      const res = await request(app)
        .post('/api/finance-batches')
        .set('Authorization', `Bearer ${financeAToken}`)
        .send({
          receiptIds: [receiptCorrectionId],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/Only APPROVED expenses may enter a finance batch/);
    });

    it('should enforce all-or-nothing rollback when an invalid expense is present', async () => {
      // Get baseline count
      const beforeRes = await request(app)
        .get('/api/finance-batches')
        .set('Authorization', `Bearer ${financeAToken}`);
      const initialCount = beforeRes.body.batches.length;

      const res = await request(app)
        .post('/api/finance-batches')
        .set('Authorization', `Bearer ${financeAToken}`)
        .send({
          receiptIds: [receiptApp1Id, receiptRejectedId],
        });

      expect(res.status).toBe(400);

      // Verify no partial batch was created
      const afterRes = await request(app)
        .get('/api/finance-batches')
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(afterRes.body.batches.length).toBe(initialCount);
    });

    it('should reject batch creation with empty receiptIds array', async () => {
      const res = await request(app)
        .post('/api/finance-batches')
        .set('Authorization', `Bearer ${financeAToken}`)
        .send({
          receiptIds: [],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/receiptIds must be a non-empty array/);
    });

    it('should reject duplicate receipt IDs in request payload', async () => {
      const res = await request(app)
        .post('/api/finance-batches')
        .set('Authorization', `Bearer ${financeAToken}`)
        .send({
          receiptIds: [receiptApp1Id, receiptApp1Id],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/Duplicate receipt IDs detected/);
    });
  });

  describe('4. Successful Batch Creation, Duplicate Prevention within Batch, & Deterministic Totals', () => {
    let createdBatchId;

    it('should successfully create a finance batch with approved expenses using UUID', async () => {
      const res = await request(app)
        .post('/api/finance-batches')
        .set('Authorization', `Bearer ${financeAToken}`)
        .send({
          receiptIds: [receiptApp1Id, receiptApp2Id],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const batch = res.body.batch;
      createdBatchId = batch.id;
      // Must be identified solely by UUID, no batch_name or notes
      expect(batch.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(batch.batchName).toBeUndefined();
      expect(batch.notes).toBeUndefined();
      expect(batch.status).toBe('OPEN');
      expect(batch.expenseCount).toBe(2);

      // $45.50 + $120.00 = $165.50 exactly
      expect(batch.totalAmount).toBe(165.50);
      expect(batch.items).toHaveLength(2);
      expect(batch.createdBy.id).toBe(financeAId);

      // Audit trail should contain CREATE
      expect(batch.auditHistory).toHaveLength(1);
      expect(batch.auditHistory[0].action).toBe('CREATE');
      expect(batch.auditHistory[0].actorRole).toBe('FINANCE');
    });

    it('should retrieve batch details by UUID', async () => {
      const res = await request(app)
        .get(`/api/finance-batches/${createdBatchId}`)
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.batch.id).toBe(createdBatchId);
      expect(res.body.batch.items).toHaveLength(2);
      expect(res.body.batch.batchName).toBeUndefined();
      expect(res.body.batch.notes).toBeUndefined();
    });

    it('should reject adding an already-included expense to the SAME batch (duplicate within batch prevention)', async () => {
      const res = await request(app)
        .post(`/api/finance-batches/${createdBatchId}/items`)
        .set('Authorization', `Bearer ${financeAToken}`)
        .send({ receiptId: receiptApp1Id });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/already included in this finance batch/);
    });

    it('should permit an approved expense to belong to another batch (no cross-batch exclusivity rule)', async () => {
      const res = await request(app)
        .post('/api/finance-batches')
        .set('Authorization', `Bearer ${financeAToken}`)
        .send({
          receiptIds: [receiptApp1Id],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.batch.items[0].receiptId).toBe(receiptApp1Id);
    });

    it('should successfully add an approved expense to an OPEN batch', async () => {
      const res = await request(app)
        .post(`/api/finance-batches/${createdBatchId}/items`)
        .set('Authorization', `Bearer ${financeAToken}`)
        .send({ receiptId: receiptApp3Id });

      expect(res.status).toBe(200);
      expect(res.body.batch.expenseCount).toBe(3);

      // $165.50 + $30.25 = $195.75 exactly
      expect(res.body.batch.totalAmount).toBe(195.75);

      // Verify ADD_ITEM in audit trail
      const actions = res.body.batch.auditHistory.map((a) => a.action);
      expect(actions).toContain('ADD_ITEM');
    });

    it('should successfully remove an expense from an OPEN batch and recalculate totals', async () => {
      const res = await request(app)
        .delete(`/api/finance-batches/${createdBatchId}/items/${receiptApp2Id}`)
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.batch.expenseCount).toBe(2);

      // $195.75 - $120.00 = $75.75 exactly ($45.50 + $30.25)
      expect(res.body.batch.totalAmount).toBe(75.75);

      // Verify REMOVE_ITEM in audit trail
      const actions = res.body.batch.auditHistory.map((a) => a.action);
      expect(actions).toContain('REMOVE_ITEM');
    });

    it('should confirm removed expense remains in APPROVED workflow state', async () => {
      const wfRes = await pool.query(
        'SELECT current_state FROM expense_workflows WHERE receipt_id = $1',
        [receiptApp2Id]
      );
      expect(wfRes.rows[0].current_state).toBe('APPROVED');
    });

    it('should complete finance review of an OPEN batch', async () => {
      const res = await request(app)
        .post(`/api/finance-batches/${createdBatchId}/review`)
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.batch.status).toBe('REVIEWED');
      expect(res.body.batch.reviewedBy.id).toBe(financeAId);
      expect(res.body.batch.reviewedAt).toBeTruthy();

      // Verify REVIEW in audit trail
      const actions = res.body.batch.auditHistory.map((a) => a.action);
      expect(actions).toContain('REVIEW');
    });

    it('should reject re-reviewing an already REVIEWED batch with 400', async () => {
      const res = await request(app)
        .post(`/api/finance-batches/${createdBatchId}/review`)
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/already been reviewed/);
    });

    it('should reject adding an item to a REVIEWED batch with 400', async () => {
      const res = await request(app)
        .post(`/api/finance-batches/${createdBatchId}/items`)
        .set('Authorization', `Bearer ${financeAToken}`)
        .send({ receiptId: receiptApp2Id });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/Only OPEN batches can be modified/);
    });

    it('should reject removing an item from a REVIEWED batch with 400', async () => {
      const res = await request(app)
        .delete(`/api/finance-batches/${createdBatchId}/items/${receiptApp1Id}`)
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/Only OPEN batches can be modified/);
    });
  });

  describe('5. Multi-Tenancy & Tenant Isolation', () => {
    it('should forbid Tenant A from creating a batch with Tenant B receipt', async () => {
      const res = await request(app)
        .post('/api/finance-batches')
        .set('Authorization', `Bearer ${financeAToken}`)
        .send({
          receiptIds: [receiptTenantBId],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/Receipt\(s\) not found or cross-tenant/);
    });

    it('should forbid Tenant B from viewing Tenant A batch (RLS isolation -> 404)', async () => {
      // Find Tenant A batch
      const listA = await request(app)
        .get('/api/finance-batches')
        .set('Authorization', `Bearer ${financeAToken}`);

      const batchAId = listA.body.batches[0].id;

      // Tenant B tries to get it
      const res = await request(app)
        .get(`/api/finance-batches/${batchAId}`)
        .set('Authorization', `Bearer ${financeBToken}`);

      expect(res.status).toBe(404);
    });

    it('should forbid Tenant B from modifying Tenant A batch (RLS isolation -> 404)', async () => {
      const listA = await request(app)
        .get('/api/finance-batches')
        .set('Authorization', `Bearer ${financeAToken}`);

      const batchAId = listA.body.batches[0].id;

      const res = await request(app)
        .post(`/api/finance-batches/${batchAId}/review`)
        .set('Authorization', `Bearer ${financeBToken}`);

      expect(res.status).toBe(404);
    });
  });
});
