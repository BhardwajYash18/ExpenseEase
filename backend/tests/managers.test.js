const request = require('supertest');
const app = require('../src/app');
const { pool, withTenantContext } = require('../src/config/db');
const { hashPassword } = require('../src/services/authService');
const { runMigrations } = require('../../database/migrator');

describe('Manager Management & Claims History (GET/POST /api/managers, GET /api/receipts)', () => {
  let tenantAId, tenantBId;
  let tenantASlug, tenantBSlug;
  let managerAToken, managerAId, managerAEmail;
  let employeeAToken, employeeAId;
  let managerBToken, managerBId;

  let approvedReceiptId, rejectedReceiptId, pendingReceiptId, draftReceiptId;

  beforeAll(async () => {
    await runMigrations();

    tenantASlug = `mgr-corp-a-${Date.now()}`;
    tenantBSlug = `mgr-corp-b-${Date.now()}`;

    // 1. Create two test tenants
    const tA = await pool.query(
      `INSERT INTO tenants (name, slug) VALUES ('Manager Corp A', $1) RETURNING id`,
      [tenantASlug]
    );
    tenantAId = tA.rows[0].id;

    const tB = await pool.query(
      `INSERT INTO tenants (name, slug) VALUES ('Manager Corp B', $1) RETURNING id`,
      [tenantBSlug]
    );
    tenantBId = tB.rows[0].id;

    const passwordHash = await hashPassword('password123');

    // 2. Create users under Tenant A (1 Manager, 1 Employee)
    await withTenantContext(tenantAId, async (client) => {
      managerAEmail = `lead.manager@${tenantASlug}.com`;
      const mRes = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, 'Lead', 'Manager', 'MANAGER') RETURNING id`,
        [tenantAId, managerAEmail, passwordHash]
      );
      managerAId = mRes.rows[0].id;

      const eRes = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, 'Staff', 'Employee', 'EMPLOYEE') RETURNING id`,
        [tenantAId, `staff@${tenantASlug}.com`, passwordHash]
      );
      employeeAId = eRes.rows[0].id;
    });

    // 3. Create user under Tenant B (1 Manager)
    await withTenantContext(tenantBId, async (client) => {
      const mBRes = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, 'Other', 'Manager', 'MANAGER') RETURNING id`,
        [tenantBId, `other.manager@${tenantBSlug}.com`, passwordHash]
      );
      managerBId = mBRes.rows[0].id;
    });

    // 4. Log in users
    const loginMA = await request(app)
      .post('/api/auth/login')
      .send({ email: managerAEmail, password: 'password123', slug: tenantASlug });
    managerAToken = loginMA.body.token;

    const loginEA = await request(app)
      .post('/api/auth/login')
      .send({ email: `staff@${tenantASlug}.com`, password: 'password123', slug: tenantASlug });
    employeeAToken = loginEA.body.token;

    const loginMB = await request(app)
      .post('/api/auth/login')
      .send({ email: `other.manager@${tenantBSlug}.com`, password: 'password123', slug: tenantBSlug });
    managerBToken = loginMB.body.token;

    const ts = Date.now();
    // 5. Seed receipts in Tenant A with different states: APPROVED, REJECTED, PENDING_APPROVAL, DRAFT
    await withTenantContext(tenantAId, async (client) => {
      // Approved receipt
      const r1 = await client.query(
        `INSERT INTO receipts (tenant_id, uploaded_by, original_filename, mime_type, file_size_bytes, storage_key, upload_status, ocr_status)
         VALUES ($1, $2, 'approved_lunch.jpg', 'image/jpeg', 1024, $3, 'COMPLETED', 'COMPLETED') RETURNING id`,
        [tenantAId, employeeAId, `key-${ts}-1`]
      );
      approvedReceiptId = r1.rows[0].id;
      await client.query(
        `INSERT INTO expense_workflows (tenant_id, receipt_id, submitted_by, current_state)
         VALUES ($1, $2, $3, 'APPROVED')`,
        [tenantAId, approvedReceiptId, employeeAId]
      );

      // Rejected receipt
      const r2 = await client.query(
        `INSERT INTO receipts (tenant_id, uploaded_by, original_filename, mime_type, file_size_bytes, storage_key, upload_status, ocr_status)
         VALUES ($1, $2, 'rejected_cab.jpg', 'image/jpeg', 2048, $3, 'COMPLETED', 'COMPLETED') RETURNING id`,
        [tenantAId, employeeAId, `key-${ts}-2`]
      );
      rejectedReceiptId = r2.rows[0].id;
      await client.query(
        `INSERT INTO expense_workflows (tenant_id, receipt_id, submitted_by, current_state)
         VALUES ($1, $2, $3, 'REJECTED')`,
        [tenantAId, rejectedReceiptId, employeeAId]
      );

      // Pending receipt
      const r3 = await client.query(
        `INSERT INTO receipts (tenant_id, uploaded_by, original_filename, mime_type, file_size_bytes, storage_key, upload_status, ocr_status)
         VALUES ($1, $2, 'pending_hotel.jpg', 'image/jpeg', 3072, $3, 'COMPLETED', 'COMPLETED') RETURNING id`,
        [tenantAId, employeeAId, `key-${ts}-3`]
      );
      pendingReceiptId = r3.rows[0].id;
      await client.query(
        `INSERT INTO expense_workflows (tenant_id, receipt_id, submitted_by, current_state)
         VALUES ($1, $2, $3, 'PENDING_APPROVAL')`,
        [tenantAId, pendingReceiptId, employeeAId]
      );

      // Draft receipt (not submitted)
      const r4 = await client.query(
        `INSERT INTO receipts (tenant_id, uploaded_by, original_filename, mime_type, file_size_bytes, storage_key, upload_status, ocr_status)
         VALUES ($1, $2, 'employee_draft.jpg', 'image/jpeg', 512, $3, 'COMPLETED', 'COMPLETED') RETURNING id`,
        [tenantAId, employeeAId, `key-${ts}-4`]
      );
      draftReceiptId = r4.rows[0].id;
      await client.query(
        `INSERT INTO expense_workflows (tenant_id, receipt_id, submitted_by, current_state)
         VALUES ($1, $2, $3, 'DRAFT')`,
        [tenantAId, draftReceiptId, employeeAId]
      );
    });
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM expense_workflows WHERE tenant_id IN ($1, $2)`, [tenantAId, tenantBId]);
    await pool.query(`DELETE FROM receipts WHERE tenant_id IN ($1, $2)`, [tenantAId, tenantBId]);
    await pool.query(`DELETE FROM users WHERE tenant_id IN ($1, $2)`, [tenantAId, tenantBId]);
    await pool.query(`DELETE FROM tenants WHERE id IN ($1, $2)`, [tenantAId, tenantBId]);
  });

  describe('1. Manager Claims History Inspection (GET /api/receipts)', () => {
    it('allows manager to list approved claims history via status=APPROVED', async () => {
      const res = await request(app)
        .get('/api/receipts?status=APPROVED')
        .set('Authorization', `Bearer ${managerAToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.receipts)).toBe(true);
      const ids = res.body.receipts.map((r) => r.id);
      expect(ids).toContain(approvedReceiptId);
      expect(ids).not.toContain(rejectedReceiptId);
      expect(ids).not.toContain(pendingReceiptId);
      expect(ids).not.toContain(draftReceiptId);
    });

    it('allows manager to list rejected claims history via status=REJECTED', async () => {
      const res = await request(app)
        .get('/api/receipts?status=REJECTED')
        .set('Authorization', `Bearer ${managerAToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.receipts)).toBe(true);
      const ids = res.body.receipts.map((r) => r.id);
      expect(ids).toContain(rejectedReceiptId);
      expect(ids).not.toContain(approvedReceiptId);
      expect(ids).not.toContain(pendingReceiptId);
      expect(ids).not.toContain(draftReceiptId);
    });

    it('allows manager to list combined history via status=HISTORY', async () => {
      const res = await request(app)
        .get('/api/receipts?status=HISTORY')
        .set('Authorization', `Bearer ${managerAToken}`);

      expect(res.status).toBe(200);
      const ids = res.body.receipts.map((r) => r.id);
      expect(ids).toContain(approvedReceiptId);
      expect(ids).toContain(rejectedReceiptId);
      expect(ids).not.toContain(pendingReceiptId);
      expect(ids).not.toContain(draftReceiptId);
    });

    it('strictly hides unsubmitted drafts of others from manager in default claims view', async () => {
      const res = await request(app)
        .get('/api/receipts')
        .set('Authorization', `Bearer ${managerAToken}`);

      expect(res.status).toBe(200);
      const ids = res.body.receipts.map((r) => r.id);
      expect(ids).toContain(pendingReceiptId);
      expect(ids).toContain(approvedReceiptId);
      expect(ids).toContain(rejectedReceiptId);
      expect(ids).not.toContain(draftReceiptId); // DRAFT must not appear
    });
  });

  describe('2. Manager Directory & RBAC Security (GET /api/managers)', () => {
    it('rejects unauthenticated request with 401', async () => {
      const res = await request(app).get('/api/managers');
      expect(res.status).toBe(401);
    });

    it('forbids EMPLOYEE role from accessing manager directory with 403', async () => {
      const res = await request(app)
        .get('/api/managers')
        .set('Authorization', `Bearer ${employeeAToken}`);

      expect(res.status).toBe(403);
    });

    it('allows MANAGER to view other added managers within their own tenant', async () => {
      const res = await request(app)
        .get('/api/managers')
        .set('Authorization', `Bearer ${managerAToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.managers)).toBe(true);
      expect(res.body.managers.length).toBeGreaterThanOrEqual(1);

      const lead = res.body.managers.find((m) => m.id === managerAId);
      expect(lead).toBeDefined();
      expect(lead.email).toBe(managerAEmail);
      expect(lead.role).toBe('MANAGER');
      expect(lead.password_hash).toBeUndefined(); // Never leaked!
    });

    it('enforces multi-tenant isolation: Tenant B manager cannot see Tenant A managers', async () => {
      const res = await request(app)
        .get('/api/managers')
        .set('Authorization', `Bearer ${managerBToken}`);

      expect(res.status).toBe(200);
      const ids = res.body.managers.map((m) => m.id);
      expect(ids).toContain(managerBId);
      expect(ids).not.toContain(managerAId); // Cross-tenant leak prevented
    });

    it('supports search query filtering by name or email', async () => {
      const res = await request(app)
        .get('/api/managers?search=Lead')
        .set('Authorization', `Bearer ${managerAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.managers.length).toBe(1);
      expect(res.body.managers[0].id).toBe(managerAId);
    });
  });

  describe('3. Add New Manager (POST /api/managers)', () => {
    it('forbids EMPLOYEE role from adding managers with 403', async () => {
      const res = await request(app)
        .post('/api/managers')
        .set('Authorization', `Bearer ${employeeAToken}`)
        .send({
          firstName: 'Unauthorized',
          lastName: 'Manager',
          email: 'unauth@test.com',
          password: 'password123',
        });

      expect(res.status).toBe(403);
    });

    it('rejects invalid inputs with 400 validation error', async () => {
      const res = await request(app)
        .post('/api/managers')
        .set('Authorization', `Bearer ${managerAToken}`)
        .send({
          firstName: '',
          lastName: 'Smith',
          email: 'invalid-email',
          password: '123', // Too short
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('successfully provisions a new manager for the tenant', async () => {
      const newManagerEmail = `alice.ops@${tenantASlug}.com`;
      const res = await request(app)
        .post('/api/managers')
        .set('Authorization', `Bearer ${managerAToken}`)
        .send({
          firstName: 'Alice',
          lastName: 'Operations',
          email: newManagerEmail,
          password: 'securePassword123!',
        });

      expect(res.status).toBe(201);
      expect(res.body.manager).toBeDefined();
      expect(res.body.manager.email).toBe(newManagerEmail);
      expect(res.body.manager.role).toBe('MANAGER');
      expect(res.body.manager.status).toBe('ACTIVE');
      expect(res.body.manager.password_hash).toBeUndefined();

      // Verify newly created manager appears in the manager list
      const listRes = await request(app)
        .get('/api/managers')
        .set('Authorization', `Bearer ${managerAToken}`);

      expect(listRes.status).toBe(200);
      const found = listRes.body.managers.find((m) => m.email === newManagerEmail);
      expect(found).toBeDefined();
      expect(found.firstName).toBe('Alice');
      expect(found.lastName).toBe('Operations');

      // Verify newly created manager can successfully log in!
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: newManagerEmail,
          password: 'securePassword123!',
          slug: tenantASlug,
        });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body.token).toBeDefined();
      expect(loginRes.body.user.role).toBe('MANAGER');
    });

    it('rejects adding duplicate email in same tenant with 409', async () => {
      const res = await request(app)
        .post('/api/managers')
        .set('Authorization', `Bearer ${managerAToken}`)
        .send({
          firstName: 'Duplicate',
          lastName: 'Manager',
          email: managerAEmail, // already exists
          password: 'password123',
        });

      expect(res.status).toBe(409);
      expect(res.body.error.message).toMatch(/already exists/i);
    });

    it('supports sorting managers by name ASC/DESC and date', async () => {
      // Add another manager to test sorting
      await request(app)
        .post('/api/managers')
        .set('Authorization', `Bearer ${managerAToken}`)
        .send({
          firstName: 'Zachary',
          lastName: 'Zane',
          email: `zach@${tenantASlug}.com`,
          password: 'password123',
        });

      const resAsc = await request(app)
        .get('/api/managers?sortBy=name&sortOrder=ASC')
        .set('Authorization', `Bearer ${managerAToken}`);

      expect(resAsc.status).toBe(200);
      const names = resAsc.body.managers.map((m) => m.firstName);
      // 'Alice' should be before 'Zachary'
      const aliceIdx = names.indexOf('Alice');
      const zachIdx = names.indexOf('Zachary');
      expect(aliceIdx).toBeLessThan(zachIdx);

      const resDesc = await request(app)
        .get('/api/managers?sortBy=name&sortOrder=DESC')
        .set('Authorization', `Bearer ${managerAToken}`);

      expect(resDesc.status).toBe(200);
      const descNames = resDesc.body.managers.map((m) => m.firstName);
      const descAliceIdx = descNames.indexOf('Alice');
      const descZachIdx = descNames.indexOf('Zachary');
      expect(descZachIdx).toBeLessThan(descAliceIdx);
    });
  });
});
