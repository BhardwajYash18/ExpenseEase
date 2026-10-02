const request = require('supertest');
const app = require('../src/app');
const { pool, withTenantContext, withTransaction } = require('../src/config/db');
const { runMigrations } = require('../../database/migrator');
const authService = require('../src/services/authService');
const storageService = require('../src/services/storageService');

describe('Checkpoint 5 — Policy Validation & Duplicate Detection Integration Tests', () => {
  let tenantAId, tenantASlug;
  let tenantBId, tenantBSlug;

  let employeeAToken, employeeBToken;
  let managerAToken, financeAToken;
  let employeeAId, employeeBId;
  let employeeTenantBToken;

  let receiptA1Id, receiptA2Id;
  const rawPassword = 'SecurePassword123!';

  beforeAll(async () => {
    await runMigrations(pool);

    const hashedPwd = await authService.hashPassword(rawPassword);

    tenantASlug = `valid-tenant-a-${Date.now()}`;
    tenantBSlug = `valid-tenant-b-${Date.now()}`;

    await withTransaction(async (client) => {
      // 1. Create Tenants
      const resA = await client.query(
        `INSERT INTO tenants (name, slug, status) VALUES ('Validation Corp A', $1, 'ACTIVE') RETURNING id`,
        [tenantASlug]
      );
      tenantAId = resA.rows[0].id;

      const resB = await client.query(
        `INSERT INTO tenants (name, slug, status) VALUES ('Validation Corp B', $1, 'ACTIVE') RETURNING id`,
        [tenantBSlug]
      );
      tenantBId = resB.rows[0].id;

      // 2. Users for Tenant A
      const empARes = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, 'Employee', 'A', 'EMPLOYEE') RETURNING id`,
        [tenantAId, `emp.a.${Date.now()}@valida.com`, hashedPwd]
      );
      employeeAId = empARes.rows[0].id;

      const empBRes = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, 'Employee', 'B', 'EMPLOYEE') RETURNING id`,
        [tenantAId, `emp.b.${Date.now()}@valida.com`, hashedPwd]
      );
      employeeBId = empBRes.rows[0].id;

      const mgrARes = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, 'Manager', 'A', 'MANAGER') RETURNING id`,
        [tenantAId, `mgr.a.${Date.now()}@valida.com`, hashedPwd]
      );
      const managerAId = mgrARes.rows[0].id;

      const finARes = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, 'Finance', 'A', 'FINANCE') RETURNING id`,
        [tenantAId, `fin.a.${Date.now()}@valida.com`, hashedPwd]
      );
      const financeAId = finARes.rows[0].id;

      // User for Tenant B
      const empBSubRes = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, 'Employee', 'TenantB', 'EMPLOYEE') RETURNING id`,
        [tenantBId, `emp.b.${Date.now()}@validb.com`, hashedPwd]
      );
      const employeeTenantBId = empBSubRes.rows[0].id;

      // Configure policy for Tenant A (max 500.00, restricted: ['Alcohol', 'Travel'])
      await client.query(
        `INSERT INTO tenant_policies (
          tenant_id, max_amount, require_receipt_above, restricted_categories
        ) VALUES ($1, 500.00, 0.00, '["Alcohol", "Travel"]'::jsonb)`,
        [tenantAId]
      );

      // Sign tokens
      employeeAToken = authService.signToken({ sub: employeeAId, tid: tenantAId, role: 'EMPLOYEE' });
      employeeBToken = authService.signToken({ sub: employeeBId, tid: tenantAId, role: 'EMPLOYEE' });
      managerAToken = authService.signToken({ sub: managerAId, tid: tenantAId, role: 'MANAGER' });
      financeAToken = authService.signToken({ sub: financeAId, tid: tenantAId, role: 'FINANCE' });
      employeeTenantBToken = authService.signToken({ sub: employeeTenantBId, tid: tenantBId, role: 'EMPLOYEE' });
    });

    // 3. Create Receipt 1 (Receipt A1) with Extraction in Tenant A
    const key1 = storageService.generateStorageKey(tenantAId, 'image/jpeg');
    await storageService.storeFile(key1, Buffer.from('image bytes 1'));

    await withTenantContext(tenantAId, async (client) => {
      const r1 = await client.query(
        `INSERT INTO receipts (
          tenant_id, uploaded_by, original_filename, mime_type, file_size_bytes,
          storage_key, upload_status, ocr_status, ocr_raw_text
        ) VALUES ($1, $2, 'receipt1.jpg', 'image/jpeg', 100, $3, 'COMPLETED', 'COMPLETED', $4)
        RETURNING id`,
        [tenantAId, employeeAId, key1, 'STARBUCKS #1042\nDate: 2026-05-10\nTotal: $25.00']
      );
      receiptA1Id = r1.rows[0].id;

      // Add extraction for Receipt A1
      await client.query(
        `INSERT INTO receipt_extractions (
          receipt_id, tenant_id, extraction_status,
          ai_merchant_name, ai_receipt_date, ai_total_amount, ai_suggested_category
        ) VALUES ($1, $2, 'COMPLETED', 'STARBUCKS #1042', '2026-05-10', 25.00, 'Meals')`,
        [receiptA1Id, tenantAId]
      );
    });

    // 4. Create Receipt 2 (Receipt A2 - exact duplicate candidate) with Extraction in Tenant A
    const key2 = storageService.generateStorageKey(tenantAId, 'image/jpeg');
    await storageService.storeFile(key2, Buffer.from('image bytes 2'));

    await withTenantContext(tenantAId, async (client) => {
      const r2 = await client.query(
        `INSERT INTO receipts (
          tenant_id, uploaded_by, original_filename, mime_type, file_size_bytes,
          storage_key, upload_status, ocr_status, ocr_raw_text
        ) VALUES ($1, $2, 'receipt2.jpg', 'image/jpeg', 100, $3, 'COMPLETED', 'COMPLETED', $4)
        RETURNING id`,
        [tenantAId, employeeAId, key2, 'STARBUCKS #1042\nDate: 2026-05-10\nTotal: $25.00']
      );
      receiptA2Id = r2.rows[0].id;

      await client.query(
        `INSERT INTO receipt_extractions (
          receipt_id, tenant_id, extraction_status,
          ai_merchant_name, ai_receipt_date, ai_total_amount, ai_suggested_category
        ) VALUES ($1, $2, 'COMPLETED', 'STARBUCKS #1042', '2026-05-10', 25.00, 'Meals')`,
        [receiptA2Id, tenantAId]
      );
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('1. Policy Validation Execution (POST /api/receipts/:id/validation)', () => {
    it('should validate receipt A1 against policy and detect no duplicates initially (self excluded)', async () => {
      // Validate A1 before A2 has been validated
      const res = await request(app)
        .post(`/api/receipts/${receiptA1Id}/validation`)
        .set('Authorization', `Bearer ${employeeAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.validation).toBeDefined();

      const { policy, duplicate, metadata } = res.body.validation;

      // Policy checks
      expect(policy.status).toBe('PASSED');
      expect(policy.violations).toHaveLength(0);
      expect(policy.rules).toHaveLength(6);
      expect(policy.version).toBe('v1');

      // Duplicate check: Receipt A2 is detected as candidate duplicate
      expect(duplicate.status).toBe('HIGH_SIMILARITY');
      expect(duplicate.score).toBeGreaterThanOrEqual(0.85);
      expect(duplicate.candidates).toHaveLength(1);
      expect(duplicate.candidates[0].candidateReceiptId).toBe(receiptA2Id);

      // Metadata
      expect(metadata.validationVersion).toBe('v1');
      expect(metadata.validatedAt).toBeDefined();
    });

    it('should evaluate policy using confirmed values over AI values (effective value precedence)', async () => {
      // Employee confirms a restricted category ('Travel') on Receipt A1
      await request(app)
        .put(`/api/receipts/${receiptA1Id}/extraction`)
        .set('Authorization', `Bearer ${employeeAToken}`)
        .send({ category: 'Travel' });

      // Run validation again
      const res = await request(app)
        .post(`/api/receipts/${receiptA1Id}/validation`)
        .set('Authorization', `Bearer ${employeeAToken}`);

      expect(res.status).toBe(200);
      const { policy } = res.body.validation;

      // Should now fail because confirmed category 'Travel' is in tenant's restricted list
      expect(policy.status).toBe('FAILED');
      expect(policy.violations).toContainEqual(expect.stringContaining("Category 'Travel' is explicitly restricted"));
    });

    it('should fail policy when totalAmount exceeds max_amount', async () => {
      // Employee confirms amount of 500.01 (over 500.00 limit)
      await request(app)
        .put(`/api/receipts/${receiptA1Id}/extraction`)
        .set('Authorization', `Bearer ${employeeAToken}`)
        .send({ category: 'Meals', totalAmount: 500.01 });

      const res = await request(app)
        .post(`/api/receipts/${receiptA1Id}/validation`)
        .set('Authorization', `Bearer ${employeeAToken}`);

      expect(res.status).toBe(200);
      const { policy } = res.body.validation;

      expect(policy.status).toBe('FAILED');
      expect(policy.violations).toContainEqual(expect.stringContaining('exceeds configured maximum amount'));
    });
  });

  describe('2. Retrieve Validation (GET /api/receipts/:id/validation)', () => {
    it('should retrieve existing validation result for Receipt A1', async () => {
      const res = await request(app)
        .get(`/api/receipts/${receiptA1Id}/validation`)
        .set('Authorization', `Bearer ${employeeAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.validation.receiptId).toBe(receiptA1Id);
      expect(res.body.validation.policy.status).toBe('FAILED');
    });

    it('should return 404 for receipt that has not been validated yet', async () => {
      // Receipt A2 has not been validated directly yet
      const res = await request(app)
        .get(`/api/receipts/${receiptA2Id}/validation`)
        .set('Authorization', `Bearer ${employeeAToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.message).toMatch(/Validation result not found/);
    });
  });

  describe('3. Multi-Tenant RLS & RBAC Enforcement', () => {
    it('Employee B cannot validate or view validation of Receipt A1 (returns 404)', async () => {
      const postRes = await request(app)
        .post(`/api/receipts/${receiptA1Id}/validation`)
        .set('Authorization', `Bearer ${employeeBToken}`);

      expect(postRes.status).toBe(404);

      const getRes = await request(app)
        .get(`/api/receipts/${receiptA1Id}/validation`)
        .set('Authorization', `Bearer ${employeeBToken}`);

      expect(getRes.status).toBe(404);
    });

    it('Manager A can validate and view validation of Receipt A1 within Tenant A', async () => {
      const postRes = await request(app)
        .post(`/api/receipts/${receiptA1Id}/validation`)
        .set('Authorization', `Bearer ${managerAToken}`);

      expect(postRes.status).toBe(200);
      expect(postRes.body.validation.id).toBeDefined();

      const getRes = await request(app)
        .get(`/api/receipts/${receiptA1Id}/validation`)
        .set('Authorization', `Bearer ${managerAToken}`);

      expect(getRes.status).toBe(200);
    });

    it('Finance A can validate and view validation of Receipt A1 within Tenant A', async () => {
      const getRes = await request(app)
        .get(`/api/receipts/${receiptA1Id}/validation`)
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(getRes.status).toBe(200);
    });

    it('Tenant B user cannot validate or access Tenant A validation (RLS isolation)', async () => {
      const postRes = await request(app)
        .post(`/api/receipts/${receiptA1Id}/validation`)
        .set('Authorization', `Bearer ${employeeTenantBToken}`);

      expect(postRes.status).toBe(404);

      const getRes = await request(app)
        .get(`/api/receipts/${receiptA1Id}/validation`)
        .set('Authorization', `Bearer ${employeeTenantBToken}`);

      expect(getRes.status).toBe(404);
    });
  });

  describe('4. Error Handling and Edge Cases', () => {
    it('should return 400 when attempting to validate a receipt with no extraction', async () => {
      // Create new un-extracted receipt
      const keyUnex = storageService.generateStorageKey(tenantAId, 'image/jpeg');
      await storageService.storeFile(keyUnex, Buffer.from('unextracted'));

      let unextractedId;
      await withTenantContext(tenantAId, async (client) => {
        const r = await client.query(
          `INSERT INTO receipts (tenant_id, uploaded_by, original_filename, mime_type, file_size_bytes, storage_key)
           VALUES ($1, $2, 'unex.jpg', 'image/jpeg', 100, $3) RETURNING id`,
          [tenantAId, employeeAId, keyUnex]
        );
        unextractedId = r.rows[0].id;
      });

      const res = await request(app)
        .post(`/api/receipts/${unextractedId}/validation`)
        .set('Authorization', `Bearer ${employeeAToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/must be extracted before running policy validation/);
    });
  });
});
