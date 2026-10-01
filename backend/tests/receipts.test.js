const request = require('supertest');
const app = require('../src/app');
const { pool, withTenantContext, withTransaction } = require('../src/config/db');
const { runMigrations } = require('../../database/migrator');
const authService = require('../src/services/authService');
const storageService = require('../src/services/storageService');

describe('Checkpoint 3 — Receipt Capture & OCR', () => {
  let tenantAId, tenantASlug;
  let tenantBId, tenantBSlug;

  let employeeAToken, employeeBToken;
  let managerAToken, financeAToken;
  let employeeAId, employeeBId;

  const rawPassword = 'SecurePassword123!';

  // Helper buffers with valid magic bytes
  const validJpegBuffer = Buffer.concat([
    Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00]),
    Buffer.from('Fake JPEG content for receipt test'),
  ]);

  const validPngBuffer = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    Buffer.from('Fake PNG content for receipt test'),
  ]);

  const validWebpBuffer = Buffer.concat([
    Buffer.from([0x52, 0x49, 0x46, 0x46]), // 'RIFF'
    Buffer.from([0x24, 0x00, 0x00, 0x00]), // File size
    Buffer.from([0x57, 0x45, 0x42, 0x50]), // 'WEBP'
    Buffer.from('Fake WebP content for receipt test'),
  ]);

  const fakePdfBuffer = Buffer.from('%PDF-1.4 Fake PDF Content');
  const fakeSpoofedPngBuffer = Buffer.from('Plain text claiming to be a PNG file');

  beforeAll(async () => {
    // Run migrations
    await runMigrations(pool);

    const hashedPwd = await authService.hashPassword(rawPassword);

    // Create Tenant A and Tenant B
    tenantASlug = `receipt-tenant-a-${Date.now()}`;
    tenantBSlug = `receipt-tenant-b-${Date.now()}`;

    await withTransaction(async (client) => {
      const resA = await client.query(
        `INSERT INTO tenants (name, slug, status) VALUES ('Receipt Corp A', $1, 'ACTIVE') RETURNING id`,
        [tenantASlug]
      );
      tenantAId = resA.rows[0].id;

      const resB = await client.query(
        `INSERT INTO tenants (name, slug, status) VALUES ('Receipt Corp B', $1, 'ACTIVE') RETURNING id`,
        [tenantBSlug]
      );
      tenantBId = resB.rows[0].id;
    });

    // Create users in Tenant A
    await withTenantContext(tenantAId, async (client) => {
      const empRes = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role, status)
         VALUES ($1, 'emp.a@test.com', $2, 'Alice', 'Emp', 'EMPLOYEE', 'ACTIVE') RETURNING id`,
        [tenantAId, hashedPwd]
      );
      employeeAId = empRes.rows[0].id;

      const mgrRes = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role, status)
         VALUES ($1, 'mgr.a@test.com', $2, 'Bob', 'Mgr', 'MANAGER', 'ACTIVE') RETURNING id`,
        [tenantAId, hashedPwd]
      );

      const finRes = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role, status)
         VALUES ($1, 'fin.a@test.com', $2, 'Charlie', 'Fin', 'FINANCE', 'ACTIVE') RETURNING id`,
        [tenantAId, hashedPwd]
      );
    });

    // Create user in Tenant B
    await withTenantContext(tenantBId, async (client) => {
      const empRes = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role, status)
         VALUES ($1, 'emp.b@test.com', $2, 'David', 'EmpB', 'EMPLOYEE', 'ACTIVE') RETURNING id`,
        [tenantBId, hashedPwd]
      );
      employeeBId = empRes.rows[0].id;
    });

    // Generate tokens
    employeeAToken = authService.signToken({ sub: employeeAId, tid: tenantAId, role: 'EMPLOYEE' });
    employeeBToken = authService.signToken({ sub: employeeBId, tid: tenantBId, role: 'EMPLOYEE' });
    managerAToken = authService.signToken({ sub: 'mgr-a-id', tid: tenantAId, role: 'MANAGER' });
    financeAToken = authService.signToken({ sub: 'fin-a-id', tid: tenantAId, role: 'FINANCE' });
  });

  afterAll(async () => {
    // Clean up test receipts, users, and tenants in proper FK order
    await withTransaction(async (client) => {
      await client.query(`DELETE FROM receipts WHERE tenant_id IN ($1, $2)`, [tenantAId, tenantBId]);
      await client.query(`DELETE FROM users WHERE tenant_id IN ($1, $2)`, [tenantAId, tenantBId]);
      await client.query(`DELETE FROM tenants WHERE id IN ($1, $2)`, [tenantAId, tenantBId]);
    });
    await pool.end();
  });

  // ==========================================
  // SECTION 1: File Validation & Format Tests
  // ==========================================
  describe('File Validation & Magic Bytes', () => {
    it('should successfully upload a valid JPEG receipt image', async () => {
      const res = await request(app)
        .post('/api/receipts/upload')
        .set('Authorization', `Bearer ${employeeAToken}`)
        .attach('receipt', validJpegBuffer, 'lunch_receipt.jpg');

      expect(res.status).toBe(201);
      expect(res.body.receipt).toBeDefined();
      expect(res.body.receipt.id).toBeDefined();
      expect(res.body.receipt.originalFilename).toBe('lunch_receipt.jpg');
      expect(res.body.receipt.mimeType).toBe('image/jpeg');
      expect(['COMPLETED', 'FAILED']).toContain(res.body.receipt.ocrStatus);
    });

    it('should successfully upload a valid PNG receipt image', async () => {
      const res = await request(app)
        .post('/api/receipts/upload')
        .set('Authorization', `Bearer ${employeeAToken}`)
        .attach('receipt', validPngBuffer, 'taxi_receipt.png');

      expect(res.status).toBe(201);
      expect(res.body.receipt.mimeType).toBe('image/png');
    });

    it('should successfully upload a valid WebP receipt image', async () => {
      const res = await request(app)
        .post('/api/receipts/upload')
        .set('Authorization', `Bearer ${employeeAToken}`)
        .attach('receipt', validWebpBuffer, 'coffee.webp');

      expect(res.status).toBe(201);
      expect(res.body.receipt.mimeType).toBe('image/webp');
    });

    it('should reject request when no file is provided', async () => {
      const res = await request(app)
        .post('/api/receipts/upload')
        .set('Authorization', `Bearer ${employeeAToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/No file provided/i);
    });

    it('should reject spoofed file content that does not match declared MIME type', async () => {
      const res = await request(app)
        .post('/api/receipts/upload')
        .set('Authorization', `Bearer ${employeeAToken}`)
        .attach('receipt', fakeSpoofedPngBuffer, 'malicious.png');

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/content does not match/i);
    });

    it('should deterministically reject PDF uploads per Checkpoint 3 scope', async () => {
      const res = await request(app)
        .post('/api/receipts/upload')
        .set('Authorization', `Bearer ${employeeAToken}`)
        .attach('receipt', fakePdfBuffer, { filename: 'document.pdf', contentType: 'application/pdf' });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/Unsupported file type/i);
    });

    it('should sanitize path traversal characters in original filename', async () => {
      const res = await request(app)
        .post('/api/receipts/upload')
        .set('Authorization', `Bearer ${employeeAToken}`)
        .attach('receipt', validJpegBuffer, '../../../etc/passwd.jpg');

      expect(res.status).toBe(201);
      expect(res.body.receipt.originalFilename).not.toContain('..');
      expect(res.body.receipt.originalFilename).not.toContain('/');
    });
  });

  // ==========================================
  // SECTION 2: Strict RBAC Role Enforcement
  // ==========================================
  describe('Strict RBAC Enforcement (AGENTS.md Section 13)', () => {
    it('should allow EMPLOYEE to upload receipts', async () => {
      const res = await request(app)
        .post('/api/receipts/upload')
        .set('Authorization', `Bearer ${employeeAToken}`)
        .attach('receipt', validJpegBuffer, 'emp_receipt.jpg');

      expect(res.status).toBe(201);
    });

    it('should forbid MANAGER from uploading receipts', async () => {
      const res = await request(app)
        .post('/api/receipts/upload')
        .set('Authorization', `Bearer ${managerAToken}`)
        .attach('receipt', validJpegBuffer, 'mgr_receipt.jpg');

      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/Forbidden/i);
    });

    it('should forbid FINANCE from uploading receipts', async () => {
      const res = await request(app)
        .post('/api/receipts/upload')
        .set('Authorization', `Bearer ${financeAToken}`)
        .attach('receipt', validJpegBuffer, 'fin_receipt.jpg');

      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/Forbidden/i);
    });

    it('should reject unauthenticated upload requests with 401', async () => {
      const res = await request(app)
        .post('/api/receipts/upload')
        .attach('receipt', validJpegBuffer, 'anon_receipt.jpg');

      expect(res.status).toBe(401);
    });
  });

  // ==========================================
  // SECTION 3: Multi-Tenancy & RLS Isolation
  // ==========================================
  describe('Multi-Tenancy & PostgreSQL RLS Isolation', () => {
    let tenantAReceiptId;

    beforeAll(async () => {
      // Upload a receipt for Tenant A
      const res = await request(app)
        .post('/api/receipts/upload')
        .set('Authorization', `Bearer ${employeeAToken}`)
        .attach('receipt', validJpegBuffer, 'tenant_a_secret.jpg');
      tenantAReceiptId = res.body.receipt.id;
    });

    it('should allow Tenant A employee to view their own receipt', async () => {
      const res = await request(app)
        .get(`/api/receipts/${tenantAReceiptId}`)
        .set('Authorization', `Bearer ${employeeAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.receipt.id).toBe(tenantAReceiptId);
    });

    it('should allow Tenant A manager to view receipt within the tenant', async () => {
      const res = await request(app)
        .get(`/api/receipts/${tenantAReceiptId}`)
        .set('Authorization', `Bearer ${managerAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.receipt.id).toBe(tenantAReceiptId);
    });

    it('should allow Tenant A finance to view receipt within the tenant', async () => {
      const res = await request(app)
        .get(`/api/receipts/${tenantAReceiptId}`)
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.receipt.id).toBe(tenantAReceiptId);
    });

    it('should block Tenant B employee from viewing Tenant A receipt (RLS isolation)', async () => {
      const res = await request(app)
        .get(`/api/receipts/${tenantAReceiptId}`)
        .set('Authorization', `Bearer ${employeeBToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.message).toMatch(/not found/i);
    });

    it('should stream original receipt image file for authorized user', async () => {
      const res = await request(app)
        .get(`/api/receipts/${tenantAReceiptId}/file`)
        .set('Authorization', `Bearer ${employeeAToken}`);

      expect(res.status).toBe(200);
      expect(res.header['content-type']).toMatch(/image\/jpeg/);
      expect(res.body).toBeDefined();
    });

    it('should block Tenant B from downloading Tenant A receipt file', async () => {
      const res = await request(app)
        .get(`/api/receipts/${tenantAReceiptId}/file`)
        .set('Authorization', `Bearer ${employeeBToken}`);

      expect(res.status).toBe(404);
    });

    it('should return OCR status and raw text via /api/receipts/:id/ocr', async () => {
      const res = await request(app)
        .get(`/api/receipts/${tenantAReceiptId}/ocr`)
        .set('Authorization', `Bearer ${employeeAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.ocr).toBeDefined();
      expect(res.body.ocr.id).toBe(tenantAReceiptId);
      expect(['COMPLETED', 'FAILED']).toContain(res.body.ocr.ocrStatus);
    });
  });
});
