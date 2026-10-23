const request = require('supertest');
const app = require('../src/app');
const { pool, withTenantContext, withTransaction } = require('../src/config/db');
const { runMigrations } = require('../../database/migrator');
const authService = require('../src/services/authService');
const storageService = require('../src/services/storageService');

describe('Finance Reimbursements & Organization Expense Ledger', () => {
  let tenantAId, tenantASlug;
  let tenantBId, tenantBSlug;
  let financeAToken, employeeAToken, managerAToken, financeBToken;
  let financeAId, employeeAId, employeeA2Id;
  let receipt1Id, receipt2Id, unapprovedReceiptId;

  const rawPassword = 'SecurePassword123!';

  beforeAll(async () => {
    await runMigrations(pool);

    const hashedPwd = await authService.hashPassword(rawPassword);
    tenantASlug = `reimb-tenant-a-${Date.now()}`;
    tenantBSlug = `reimb-tenant-b-${Date.now()}`;

    await withTransaction(async (client) => {
      // 1. Create Tenant A
      const resA = await client.query(
        `INSERT INTO tenants (name, slug, status) VALUES ('Acme Finance Corp', $1, 'ACTIVE') RETURNING id`,
        [tenantASlug]
      );
      tenantAId = resA.rows[0].id;

      // 2. Create Tenant B
      const resB = await client.query(
        `INSERT INTO tenants (name, slug, status) VALUES ('Rival Corp', $1, 'ACTIVE') RETURNING id`,
        [tenantBSlug]
      );
      tenantBId = resB.rows[0].id;

      // 3. Users for Tenant A
      const finA = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, 'Finance', 'Officer', 'FINANCE') RETURNING id`,
        [tenantAId, `fin.${Date.now()}@acme.com`, hashedPwd]
      );
      financeAId = finA.rows[0].id;

      const empA = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, 'Alice', 'Smith', 'EMPLOYEE') RETURNING id`,
        [tenantAId, `alice.${Date.now()}@acme.com`, hashedPwd]
      );
      employeeAId = empA.rows[0].id;

      const empA2 = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, 'Bob', 'Jones', 'EMPLOYEE') RETURNING id`,
        [tenantAId, `bob.${Date.now()}@acme.com`, hashedPwd]
      );
      employeeA2Id = empA2.rows[0].id;

      const mgrA = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, 'Manager', 'Mike', 'MANAGER') RETURNING id`,
        [tenantAId, `mgr.${Date.now()}@acme.com`, hashedPwd]
      );
      const managerAId = mgrA.rows[0].id;

      // 4. Finance user for Tenant B
      const finB = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, 'Finance', 'Rival', 'FINANCE') RETURNING id`,
        [tenantBId, `fin.${Date.now()}@rival.com`, hashedPwd]
      );
      const financeBId = finB.rows[0].id;

      financeAToken = authService.signToken({ sub: financeAId, tid: tenantAId, role: 'FINANCE' });
      employeeAToken = authService.signToken({ sub: employeeAId, tid: tenantAId, role: 'EMPLOYEE' });
      managerAToken = authService.signToken({ sub: managerAId, tid: tenantAId, role: 'MANAGER' });
      financeBToken = authService.signToken({ sub: financeBId, tid: tenantBId, role: 'FINANCE' });
    });

    // Create receipts and approved workflows for Alice in Tenant A
    const key1 = storageService.generateStorageKey(tenantAId, 'image/jpeg');
    const key2 = storageService.generateStorageKey(tenantAId, 'image/jpeg');
    const key3 = storageService.generateStorageKey(tenantAId, 'image/jpeg');

    await storageService.storeFile(key1, Buffer.from('receipt 1'));
    await storageService.storeFile(key2, Buffer.from('receipt 2'));
    await storageService.storeFile(key3, Buffer.from('receipt 3'));

    await withTenantContext(tenantAId, async (client) => {
      // Claim 1: Approved, 150.00
      const r1 = await client.query(
        `INSERT INTO receipts (tenant_id, uploaded_by, original_filename, mime_type, file_size_bytes, storage_key, upload_status, ocr_status)
         VALUES ($1, $2, 'hotel.jpg', 'image/jpeg', 1000, $3, 'COMPLETED', 'COMPLETED') RETURNING id`,
        [tenantAId, employeeAId, key1]
      );
      receipt1Id = r1.rows[0].id;

      await client.query(
        `INSERT INTO receipt_extractions (receipt_id, tenant_id, confirmed_merchant_name, confirmed_total_amount, confirmed_currency, confirmed_category, extraction_status)
         VALUES ($1, $2, 'Grand Hyatt', 150.00, 'USD', 'Lodging', 'MANUALLY_CONFIRMED')`,
        [receipt1Id, tenantAId]
      );

      await client.query(
        `INSERT INTO expense_workflows (tenant_id, receipt_id, submitted_by, current_state, submitted_at, completed_at, reimbursement_status)
         VALUES ($1, $2, $3, 'APPROVED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'UNPAID')`,
        [tenantAId, receipt1Id, employeeAId]
      );

      // Claim 2: Approved, 50.00
      const r2 = await client.query(
        `INSERT INTO receipts (tenant_id, uploaded_by, original_filename, mime_type, file_size_bytes, storage_key, upload_status, ocr_status)
         VALUES ($1, $2, 'dinner.jpg', 'image/jpeg', 1000, $3, 'COMPLETED', 'COMPLETED') RETURNING id`,
        [tenantAId, employeeAId, key2]
      );
      receipt2Id = r2.rows[0].id;

      await client.query(
        `INSERT INTO receipt_extractions (receipt_id, tenant_id, confirmed_merchant_name, confirmed_total_amount, confirmed_currency, confirmed_category, extraction_status)
         VALUES ($1, $2, 'City Bistro', 50.00, 'USD', 'Meals', 'MANUALLY_CONFIRMED')`,
        [receipt2Id, tenantAId]
      );

      await client.query(
        `INSERT INTO expense_workflows (tenant_id, receipt_id, submitted_by, current_state, submitted_at, completed_at, reimbursement_status)
         VALUES ($1, $2, $3, 'APPROVED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'UNPAID')`,
        [tenantAId, receipt2Id, employeeAId]
      );

      // Claim 3: PENDING_APPROVAL (Unapproved - should be excluded from reimbursements)
      const r3 = await client.query(
        `INSERT INTO receipts (tenant_id, uploaded_by, original_filename, mime_type, file_size_bytes, storage_key, upload_status, ocr_status)
         VALUES ($1, $2, 'taxi.jpg', 'image/jpeg', 1000, $3, 'COMPLETED', 'COMPLETED') RETURNING id`,
        [tenantAId, employeeAId, key3]
      );
      unapprovedReceiptId = r3.rows[0].id;

      await client.query(
        `INSERT INTO receipt_extractions (receipt_id, tenant_id, confirmed_merchant_name, confirmed_total_amount, confirmed_currency, confirmed_category, extraction_status)
         VALUES ($1, $2, 'Yellow Cab', 35.00, 'USD', 'Travel', 'MANUALLY_CONFIRMED')`,
        [unapprovedReceiptId, tenantAId]
      );

      await client.query(
        `INSERT INTO expense_workflows (tenant_id, receipt_id, submitted_by, current_state, submitted_at, reimbursement_status)
         VALUES ($1, $2, $3, 'PENDING_APPROVAL', CURRENT_TIMESTAMP, 'UNPAID')`,
        [tenantAId, unapprovedReceiptId, employeeAId]
      );
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('1. Reimbursement Summary & Calculations', () => {
    it('Finance can fetch reimbursement summary: includes only APPROVED claims, excludes PENDING claims', async () => {
      const res = await request(app)
        .get('/api/finance/reimbursements/summary')
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.summaries).toBeDefined();

      const aliceSummary = res.body.summaries.find((s) => s.employeeId === employeeAId);
      expect(aliceSummary).toBeDefined();
      expect(aliceSummary.claimCount).toBe(2); // Only receipt1 and receipt2, NOT receipt3
      expect(Number(aliceSummary.totalApprovedAmount)).toBe(200.00); // 150 + 50
      expect(Number(aliceSummary.totalOutstandingAmount)).toBe(200.00);
      expect(Number(aliceSummary.totalReimbursedAmount)).toBe(0.00);
    });

    it('Non-Finance roles are rejected with 403 Forbidden', async () => {
      const empRes = await request(app)
        .get('/api/finance/reimbursements/summary')
        .set('Authorization', `Bearer ${employeeAToken}`);
      expect(empRes.status).toBe(403);

      const mgrRes = await request(app)
        .get('/api/finance/reimbursements/summary')
        .set('Authorization', `Bearer ${managerAToken}`);
      expect(mgrRes.status).toBe(403);
    });

    it('Cross-tenant isolation: Tenant B Finance user cannot view Tenant A reimbursements', async () => {
      const res = await request(app)
        .get('/api/finance/reimbursements/summary')
        .set('Authorization', `Bearer ${financeBToken}`);

      expect(res.status).toBe(200);
      expect(res.body.summaries).toHaveLength(0); // Tenant B has no approved claims
    });
  });

  describe('2. Partial Payments & Payment Ledger', () => {
    it('should record a partial payment, updating total_reimbursed_amount and status to PARTIALLY_PAID', async () => {
      const res = await request(app)
        .post('/api/finance/reimbursements/payments')
        .set('Authorization', `Bearer ${financeAToken}`)
        .send({
          receiptId: receipt1Id,
          amount: 75.00,
          paymentMethod: 'DIRECT_DEPOSIT',
          paymentReference: 'ACH-100234',
          notes: 'Partial advance for hotel stay',
        });

      expect(res.status).toBe(200);
      expect(res.body.newReimbursementStatus).toBe('PARTIALLY_PAID');
      expect(Number(res.body.totalReimbursedAmount)).toBe(75.00);

      // Verify summary updates outstanding balance accordingly
      const sumRes = await request(app)
        .get('/api/finance/reimbursements/summary')
        .set('Authorization', `Bearer ${financeAToken}`);

      const alice = sumRes.body.summaries.find((s) => s.employeeId === employeeAId);
      expect(Number(alice.totalReimbursedAmount)).toBe(75.00);
      expect(Number(alice.totalOutstandingAmount)).toBe(125.00); // 200 - 75
    });

    it('should record final payment and update status to PAID', async () => {
      const res = await request(app)
        .post('/api/finance/reimbursements/payments')
        .set('Authorization', `Bearer ${financeAToken}`)
        .send({
          receiptId: receipt1Id,
          amount: 75.00,
          paymentMethod: 'DIRECT_DEPOSIT',
          paymentReference: 'ACH-100235',
        });

      expect(res.status).toBe(200);
      expect(res.body.newReimbursementStatus).toBe('PAID');
      expect(Number(res.body.totalReimbursedAmount)).toBe(150.00);
    });

    it('rejects payment for unapproved claim', async () => {
      const res = await request(app)
        .post('/api/finance/reimbursements/payments')
        .set('Authorization', `Bearer ${financeAToken}`)
        .send({
          receiptId: unapprovedReceiptId,
          amount: 35.00,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/Claim must be APPROVED/);
    });
  });

  describe('3. Reimbursement Email Preview & Dispatch', () => {
    it('generates an accurate preview with simulation warning in mock mode', async () => {
      const res = await request(app)
        .post('/api/finance/reimbursements/preview')
        .set('Authorization', `Bearer ${financeAToken}`)
        .send({
          employeeId: employeeAId,
          claimIds: [receipt2Id],
          emailType: 'REIMBURSEMENT_APPROVED',
          customNotes: 'Batch #1 reimbursement approved',
        });

      expect(res.status).toBe(200);
      expect(res.body.recipientEmail).toMatch(/alice/);
      expect(res.body.deliveryMode).toBe('SIMULATED');
      expect(res.body.isSimulated).toBe(true);
      expect(res.body.previewText).toMatch(/SIMULATED EMAIL/);
      expect(res.body.previewText).toMatch(/Batch #1 reimbursement approved/);
      expect(res.body.previewText).toMatch(/City Bistro/);
    });

    it('sends individual simulated email, logs to audit history, and enforces idempotency', async () => {
      const idempotencyKey = `test-idemp-${Date.now()}`;

      // First send
      const sendRes = await request(app)
        .post('/api/finance/reimbursements/send')
        .set('Authorization', `Bearer ${financeAToken}`)
        .send({
          employeeIds: [employeeAId],
          claimIdsByEmployee: { [employeeAId]: [receipt2Id] },
          emailType: 'REIMBURSEMENT_APPROVED',
          idempotencyKey,
        });

      expect(sendRes.status).toBe(200);
      expect(sendRes.body.sentCount).toBe(1);
      const log = sendRes.body.results[0];
      expect(log.deliveryMode).toBe('SIMULATED');
      expect(log.status).toBe('MOCK_SENT');

      // Duplicate send with same idempotency key must not send duplicate
      const dupRes = await request(app)
        .post('/api/finance/reimbursements/send')
        .set('Authorization', `Bearer ${financeAToken}`)
        .send({
          employeeIds: [employeeAId],
          claimIdsByEmployee: { [employeeAId]: [receipt2Id] },
          emailType: 'REIMBURSEMENT_APPROVED',
          idempotencyKey,
        });

      expect(dupRes.status).toBe(200);
      expect(dupRes.body.results[0].alreadySent).toBe(true);
    });

    it('fetches email audit logs with recipient, sender, and simulation status', async () => {
      const res = await request(app)
        .get('/api/finance/reimbursements/email-logs')
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.emailLogs.length).toBeGreaterThanOrEqual(1);
      expect(res.body.emailLogs[0].deliveryMode).toBe('SIMULATED');
    });
  });

  describe('4. Organization Expense Ledger (Feature B)', () => {
    it('Finance can query organization-wide expenses across all workflow states', async () => {
      const res = await request(app)
        .get('/api/finance/expenses')
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.receipts.length).toBeGreaterThanOrEqual(3);
    });

    it('Filters organization expenses by status', async () => {
      const res = await request(app)
        .get('/api/finance/expenses?status=PENDING_APPROVAL')
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.receipts.every((r) => r.workflowState === 'PENDING_APPROVAL')).toBe(true);
    });
  });
});
