const request = require('supertest');
const app = require('../src/app');
const { pool, withTenantContext } = require('../src/config/db');
const authService = require('../src/services/authService');
const storageService = require('../src/services/storageService');

describe('Checkpoint 6 — Approval Workflow Integration Tests', () => {
  let tenantAId, tenantBId;
  let employeeAId, employeeAToken;
  let managerAId, managerAToken;
  let financeAId, financeAToken;
  let employeeBId, employeeBToken;
  let tenantBUserId, tenantBToken;
  let receipt1Id, receipt2Id;

  beforeAll(async () => {
    // 1. Setup tenants
    const slugA = `workflow-corp-${Date.now()}`;
    const slugB = `other-corp-${Date.now()}`;
    const tA = await pool.query(
      "INSERT INTO tenants (name, slug) VALUES ('Workflow Corp', $1) RETURNING id",
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
        [tenantAId, `emp.a.${Date.now()}@workflow.test`]
      );
      employeeAId = uEmp.rows[0].id;

      const uEmp2 = await client.query(
        "INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role) VALUES ($1, $2, 'hash', 'Emp', 'B', 'EMPLOYEE') RETURNING id",
        [tenantAId, `emp.b.${Date.now()}@workflow.test`]
      );
      employeeBId = uEmp2.rows[0].id;

      const uMgr = await client.query(
        "INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role) VALUES ($1, $2, 'hash', 'Mgr', 'A', 'MANAGER') RETURNING id",
        [tenantAId, `mgr.a.${Date.now()}@workflow.test`]
      );
      managerAId = uMgr.rows[0].id;

      const uFin = await client.query(
        "INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role) VALUES ($1, $2, 'hash', 'Fin', 'A', 'FINANCE') RETURNING id",
        [tenantAId, `fin.a.${Date.now()}@workflow.test`]
      );
      financeAId = uFin.rows[0].id;
    });

    // 3. Setup user in Tenant B
    await withTenantContext(tenantBId, async (client) => {
      const uB = await client.query(
        "INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role) VALUES ($1, $2, 'hash', 'User', 'B', 'MANAGER') RETURNING id",
        [tenantBId, `user.b.${Date.now()}@other.test`]
      );
      tenantBUserId = uB.rows[0].id;
    });

    // Sign tokens
    employeeAToken = authService.signToken({ sub: employeeAId, tid: tenantAId, role: 'EMPLOYEE' });
    employeeBToken = authService.signToken({ sub: employeeBId, tid: tenantAId, role: 'EMPLOYEE' });
    managerAToken = authService.signToken({ sub: managerAId, tid: tenantAId, role: 'MANAGER' });
    financeAToken = authService.signToken({ sub: financeAId, tid: tenantAId, role: 'FINANCE' });
    tenantBToken = authService.signToken({ sub: tenantBUserId, tid: tenantBId, role: 'MANAGER' });

    // 4. Create Receipt 1 with extraction and validation
    const key1 = storageService.generateStorageKey(tenantAId, 'image/jpeg');
    await storageService.storeFile(key1, Buffer.from('test receipt bytes 1'));

    await withTenantContext(tenantAId, async (client) => {
      const r1 = await client.query(
        `INSERT INTO receipts (
          tenant_id, uploaded_by, original_filename, mime_type, file_size_bytes, storage_key, upload_status, ocr_status, ocr_raw_text
        ) VALUES ($1, $2, 'receipt1.jpg', 'image/jpeg', 100, $3, 'COMPLETED', 'COMPLETED', 'SAMPLE RECEIPT $50')
        RETURNING id`,
        [tenantAId, employeeAId, key1]
      );
      receipt1Id = r1.rows[0].id;

      await client.query(
        `INSERT INTO receipt_extractions (
          receipt_id, tenant_id, extraction_status, ai_merchant_name, ai_receipt_date, ai_total_amount, ai_suggested_category
        ) VALUES ($1, $2, 'COMPLETED', 'Acme Supplies', '2026-05-15', 50.00, 'Office Supplies')`,
        [receipt1Id, tenantAId]
      );

      await client.query(
        `INSERT INTO receipt_validation_results (
          receipt_id, tenant_id, validation_status, validation_version, policy_rules_result, duplicate_status, duplicate_score
        ) VALUES ($1, $2, 'PASSED', 'v1', '[]'::jsonb, 'NO_MATCH', 0.00)`,
        [receipt1Id, tenantAId]
      );
    });

    // 5. Create Receipt 2 (unextracted) for prerequisite testing
    const key2 = storageService.generateStorageKey(tenantAId, 'image/jpeg');
    await storageService.storeFile(key2, Buffer.from('test receipt bytes 2'));

    await withTenantContext(tenantAId, async (client) => {
      const r2 = await client.query(
        `INSERT INTO receipts (
          tenant_id, uploaded_by, original_filename, mime_type, file_size_bytes, storage_key, upload_status, ocr_status
        ) VALUES ($1, $2, 'receipt2.jpg', 'image/jpeg', 100, $3, 'COMPLETED', 'PENDING')
        RETURNING id`,
        [tenantAId, employeeAId, key2]
      );
      receipt2Id = r2.rows[0].id;
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('1. Initial State & Workflow Inspection (GET /api/receipts/:id/workflow)', () => {
    it('should initialize and return workflow in DRAFT state for a new receipt', async () => {
      const res = await request(app)
        .get(`/api/receipts/${receipt1Id}/workflow`)
        .set('Authorization', `Bearer ${employeeAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.workflow).toBeDefined();
      expect(res.body.workflow.currentState).toBe('DRAFT');
      expect(res.body.workflow.receiptId).toBe(receipt1Id);
      expect(res.body.workflow.history).toHaveLength(0);
    });

    it('should forbid other employee from viewing workflow of another user', async () => {
      const res = await request(app)
        .get(`/api/receipts/${receipt1Id}/workflow`)
        .set('Authorization', `Bearer ${employeeBToken}`);

      expect(res.status).toBe(404);
    });

    it('should allow manager in same tenant to view workflow', async () => {
      const res = await request(app)
        .get(`/api/receipts/${receipt1Id}/workflow`)
        .set('Authorization', `Bearer ${managerAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.workflow.currentState).toBe('DRAFT');
    });
  });

  describe('2. Expense Submission (POST /api/receipts/:id/workflow/submit)', () => {
    it('should fail submission if receipt has no extraction record', async () => {
      const res = await request(app)
        .post(`/api/receipts/${receipt2Id}/workflow/submit`)
        .set('Authorization', `Bearer ${employeeAToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/extraction.*completed/i);
    });

    it('should reject submission from a user who is not the uploader', async () => {
      const res = await request(app)
        .post(`/api/receipts/${receipt1Id}/workflow/submit`)
        .set('Authorization', `Bearer ${employeeBToken}`);

      expect(res.status).toBe(403);
    });

    it('should successfully submit valid receipt and transition to PENDING_APPROVAL with audit trail', async () => {
      const res = await request(app)
        .post(`/api/receipts/${receipt1Id}/workflow/submit`)
        .set('Authorization', `Bearer ${employeeAToken}`);

      expect(res.status).toBe(200);
      const { workflow } = res.body;
      expect(workflow.currentState).toBe('PENDING_APPROVAL');
      expect(workflow.submittedAt).toBeDefined();

      // Exactly 1 SUBMIT action recorded in audit history
      expect(workflow.history.length).toBe(1);
      expect(workflow.history[0].action).toBe('SUBMIT');
      expect(workflow.history[0].previousState).toBe('DRAFT');
      expect(workflow.history[0].newState).toBe('PENDING_APPROVAL');
    });

    it('should reject repeated submission when already in PENDING_APPROVAL', async () => {
      const res = await request(app)
        .post(`/api/receipts/${receipt1Id}/workflow/submit`)
        .set('Authorization', `Bearer ${employeeAToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/Cannot submit expense from current state/i);
    });
  });

  describe('3. Separation of Duties & RBAC Enforcement', () => {
    it('should forbid employee from approving expense', async () => {
      const res = await request(app)
        .post(`/api/receipts/${receipt1Id}/workflow/approve`)
        .set('Authorization', `Bearer ${employeeAToken}`)
        .send({ comment: 'Self approving' });

      expect(res.status).toBe(403);
    });

    it('should forbid employee from rejecting expense', async () => {
      const res = await request(app)
        .post(`/api/receipts/${receipt1Id}/workflow/reject`)
        .set('Authorization', `Bearer ${employeeAToken}`)
        .send({ reason: 'Self reject' });

      expect(res.status).toBe(403);
    });

    it('should forbid finance role from approving expense in CP6', async () => {
      const res = await request(app)
        .post(`/api/receipts/${receipt1Id}/workflow/approve`)
        .set('Authorization', `Bearer ${financeAToken}`)
        .send({ comment: 'Finance trying to approve' });

      expect(res.status).toBe(403);
    });

    it('should forbid finance role from rejecting expense in CP6', async () => {
      const res = await request(app)
        .post(`/api/receipts/${receipt1Id}/workflow/reject`)
        .set('Authorization', `Bearer ${financeAToken}`)
        .send({ reason: 'Finance trying to reject' });

      expect(res.status).toBe(403);
    });

    it('should forbid submitter even if holding manager role from approving own expense (no self-approval)', async () => {
      // Create a receipt uploaded by managerA
      let managerReceiptId;
      const mgrKey = storageService.generateStorageKey(tenantAId, 'image/jpeg');
      await storageService.storeFile(mgrKey, Buffer.from('mgr test receipt bytes'));

      await withTenantContext(tenantAId, async (client) => {
        const r = await client.query(
          `INSERT INTO receipts (
            tenant_id, uploaded_by, original_filename, mime_type, file_size_bytes, storage_key, upload_status
          ) VALUES ($1, $2, 'mgr_receipt.jpg', 'image/jpeg', 100, $3, 'COMPLETED')
          RETURNING id`,
          [tenantAId, managerAId, mgrKey]
        );
        managerReceiptId = r.rows[0].id;

        await client.query(
          `INSERT INTO receipt_extractions (
            receipt_id, tenant_id, extraction_status, ai_total_amount
          ) VALUES ($1, $2, 'COMPLETED', 100.00)`,
          [managerReceiptId, tenantAId]
        );

        await client.query(
          `INSERT INTO receipt_validation_results (
            receipt_id, tenant_id, validation_status
          ) VALUES ($1, $2, 'PASSED')`,
          [managerReceiptId, tenantAId]
        );

        // Put in PENDING_APPROVAL
        await client.query(
          `INSERT INTO expense_workflows (
            tenant_id, receipt_id, submitted_by, current_state
          ) VALUES ($1, $2, $3, 'PENDING_APPROVAL')`,
          [tenantAId, managerReceiptId, managerAId]
        );
      });

      // ManagerA tries to approve their own receipt
      const res = await request(app)
        .post(`/api/receipts/${managerReceiptId}/workflow/approve`)
        .set('Authorization', `Bearer ${managerAToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/cannot approve their own expense/i);
    });
  });

  describe('4. Rejection and Correction Requests with Mandatory Reasons', () => {
    it('should reject request-correction if reason is missing', async () => {
      const res = await request(app)
        .post(`/api/receipts/${receipt1Id}/workflow/request-correction`)
        .set('Authorization', `Bearer ${managerAToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/reason is strictly required/i);
    });

    it('should allow manager to request correction with mandatory reason', async () => {
      const res = await request(app)
        .post(`/api/receipts/${receipt1Id}/workflow/request-correction`)
        .set('Authorization', `Bearer ${managerAToken}`)
        .send({ reason: 'Please attach a clearer photo of the itemized total' });

      expect(res.status).toBe(200);
      expect(res.body.workflow.currentState).toBe('CORRECTION_REQUESTED');

      const lastHistory = res.body.workflow.history[res.body.workflow.history.length - 1];
      expect(lastHistory.action).toBe('REQUEST_CORRECTION');
      expect(lastHistory.reason).toBe('Please attach a clearer photo of the itemized total');
    });

    it('should allow employee to resubmit from CORRECTION_REQUESTED back to PENDING_APPROVAL', async () => {
      const res = await request(app)
        .post(`/api/receipts/${receipt1Id}/workflow/submit`)
        .set('Authorization', `Bearer ${employeeAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.workflow.currentState).toBe('PENDING_APPROVAL');
    });

    it('should reject rejection attempt without reason', async () => {
      const res = await request(app)
        .post(`/api/receipts/${receipt1Id}/workflow/reject`)
        .set('Authorization', `Bearer ${managerAToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/rejection reason is strictly required/i);
    });
  });

  describe('5. Approval Terminal State & Finance Access', () => {
    it('should allow manager to approve PENDING_APPROVAL expense', async () => {
      const res = await request(app)
        .post(`/api/receipts/${receipt1Id}/workflow/approve`)
        .set('Authorization', `Bearer ${managerAToken}`)
        .send({ comment: 'Approved for reimbursement' });

      expect(res.status).toBe(200);
      expect(res.body.workflow.currentState).toBe('APPROVED');
      expect(res.body.workflow.completedAt).toBeDefined();

      const lastHistory = res.body.workflow.history[res.body.workflow.history.length - 1];
      expect(lastHistory.action).toBe('APPROVE');
      expect(lastHistory.reason).toBe('Approved for reimbursement');
    });

    it('should reject repeated approval when already in APPROVED state', async () => {
      const res = await request(app)
        .post(`/api/receipts/${receipt1Id}/workflow/approve`)
        .set('Authorization', `Bearer ${managerAToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/Cannot approve expense in state 'APPROVED'/i);
    });

    it('should allow finance role to review approved expense without requiring transition', async () => {
      const res = await request(app)
        .get(`/api/receipts/${receipt1Id}/workflow`)
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.workflow.currentState).toBe('APPROVED');
    });
  });

  describe('6. Tenant Isolation (RLS Enforcement)', () => {
    it('Tenant B manager cannot view Tenant A workflow (RLS isolation)', async () => {
      const res = await request(app)
        .get(`/api/receipts/${receipt1Id}/workflow`)
        .set('Authorization', `Bearer ${tenantBToken}`);

      expect(res.status).toBe(404);
    });

    it('Tenant B manager cannot approve Tenant A workflow (RLS isolation)', async () => {
      const res = await request(app)
        .post(`/api/receipts/${receipt1Id}/workflow/approve`)
        .set('Authorization', `Bearer ${tenantBToken}`);

      expect(res.status).toBe(404);
    });
  });
});
