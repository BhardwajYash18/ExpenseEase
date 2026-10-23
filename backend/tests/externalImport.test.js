const request = require('supertest');
const app = require('../src/app');
const { pool, withTransaction } = require('../src/config/db');
const { runMigrations } = require('../../database/migrator');
const authService = require('../src/services/authService');

describe('External Financial Data Import & GL Journal Entries (Feature C)', () => {
  let tenantAId, tenantASlug;
  let tenantBId, tenantBSlug;
  let financeAToken, employeeAToken, financeBToken;
  let financeAId, employeeAId;

  const rawPassword = 'SecurePassword123!';

  const validBalancedCsv =
    `Date,Account,Description,Debit,Credit\n` +
    `2026-10-15,6001 - Office Supplies,Staples stationery,120.50,0.00\n` +
    `2026-10-15,2000 - Accounts Payable,Payable - Staples,0.00,120.50\n` +
    `2026-10-16,6002 - Software Subscriptions,GitHub Enterprise,250.00,0.00\n` +
    `2026-10-16,2000 - Accounts Payable,Payable - GitHub,0.00,250.00\n`;

  const imbalancedCsv =
    `Date,Account,Description,Debit,Credit\n` +
    `2026-10-15,6001 - Office Supplies,Staples stationery,120.50,0.00\n` +
    `2026-10-15,2000 - Accounts Payable,Payable - Staples,0.00,100.00\n`; // Missing 20.50

  const malformedCsv =
    `InvalidCol1,InvalidCol2\n` +
    `something,else\n`;

  beforeAll(async () => {
    await runMigrations(pool);

    const hashedPwd = await authService.hashPassword(rawPassword);
    tenantASlug = `ext-tenant-a-${Date.now()}`;
    tenantBSlug = `ext-tenant-b-${Date.now()}`;

    await withTransaction(async (client) => {
      // Create Tenant A
      const resA = await client.query(
        `INSERT INTO tenants (name, slug, status) VALUES ('Import Corp A', $1, 'ACTIVE') RETURNING id`,
        [tenantASlug]
      );
      tenantAId = resA.rows[0].id;

      // Create Tenant B
      const resB = await client.query(
        `INSERT INTO tenants (name, slug, status) VALUES ('Import Corp B', $1, 'ACTIVE') RETURNING id`,
        [tenantBSlug]
      );
      tenantBId = resB.rows[0].id;

      // Users for Tenant A
      const finA = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, 'Finance', 'User', 'FINANCE') RETURNING id`,
        [tenantAId, `fin.${Date.now()}@importa.com`, hashedPwd]
      );
      financeAId = finA.rows[0].id;

      const empA = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, 'Employee', 'User', 'EMPLOYEE') RETURNING id`,
        [tenantAId, `emp.${Date.now()}@importa.com`, hashedPwd]
      );
      employeeAId = empA.rows[0].id;

      // User for Tenant B
      const finB = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, 'Finance', 'Rival', 'FINANCE') RETURNING id`,
        [tenantBId, `fin.${Date.now()}@importb.com`, hashedPwd]
      );
      const financeBId = finB.rows[0].id;

      financeAToken = authService.signToken({ sub: financeAId, tid: tenantAId, role: 'FINANCE' });
      employeeAToken = authService.signToken({ sub: employeeAId, tid: tenantAId, role: 'EMPLOYEE' });
      financeBToken = authService.signToken({ sub: financeBId, tid: tenantBId, role: 'FINANCE' });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('1. CSV Upload, Validation, and Double-Entry Balancing', () => {
    let createdImportId;

    it('successfully uploads and previews valid balanced CSV', async () => {
      const res = await request(app)
        .post('/api/finance/external-imports/upload')
        .set('Authorization', `Bearer ${financeAToken}`)
        .attach('file', Buffer.from(validBalancedCsv), 'external_ledger.csv');

      expect(res.status).toBe(200);
      expect(res.body.importId).toBeDefined();
      expect(res.body.status).toBe('PREVIEWED');
      expect(res.body.rowCount).toBe(4);
      expect(res.body.isBalanced).toBe(true);
      expect(Number(res.body.totalDebit)).toBe(370.50);
      expect(Number(res.body.totalCredit)).toBe(370.50);
      expect(res.body.canCommit).toBe(true);

      createdImportId = res.body.importId;
    });

    it('rejects duplicate file upload with 409 Conflict', async () => {
      const res = await request(app)
        .post('/api/finance/external-imports/upload')
        .set('Authorization', `Bearer ${financeAToken}`)
        .attach('file', Buffer.from(validBalancedCsv), 'external_ledger.csv');

      expect(res.status).toBe(409);
      expect(res.body.error.message).toMatch(/Duplicate file detected/);
    });

    it('detects debit/credit imbalance in CSV and flags cannot commit', async () => {
      const res = await request(app)
        .post('/api/finance/external-imports/upload')
        .set('Authorization', `Bearer ${financeAToken}`)
        .attach('file', Buffer.from(imbalancedCsv), 'imbalanced.csv');

      expect(res.status).toBe(200);
      expect(res.body.isBalanced).toBe(false);
      expect(res.body.canCommit).toBe(false);
      expect(res.body.errors.some((e) => e.includes('imbalance'))).toBe(true);
    });

    it('rejects malformed CSV with missing required columns with 400', async () => {
      const res = await request(app)
        .post('/api/finance/external-imports/upload')
        .set('Authorization', `Bearer ${financeAToken}`)
        .attach('file', Buffer.from(malformedCsv), 'malformed.csv');

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/Date column/);
    });

    it('commits previewed import to double-entry Journal Entry with audit history', async () => {
      const res = await request(app)
        .post(`/api/finance/external-imports/${createdImportId}/commit`)
        .set('Authorization', `Bearer ${financeAToken}`)
        .send({ finalizeImmediately: true });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('POSTED');
      expect(res.body.journalEntryId).toBeDefined();
      expect(res.body.journalEntryStatus).toBe('FINALIZED');
      expect(res.body.lineCount).toBe(4);

      // Verify created journal entry can be fetched via general journal entries API
      const jeRes = await request(app)
        .get(`/api/journal-entries/${res.body.journalEntryId}`)
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(jeRes.status).toBe(200);
      expect(jeRes.body.journalEntry.status).toBe('FINALIZED');
      expect(jeRes.body.journalEntry.totalDebit).toBe(370.50);
      expect(jeRes.body.journalEntry.totalCredit).toBe(370.50);
      expect(jeRes.body.journalEntry.lines).toHaveLength(4);
    });
  });

  describe('2. Authorization & Tenant Isolation', () => {
    it('Employee cannot upload or view external imports (403 Forbidden)', async () => {
      const res = await request(app)
        .get('/api/finance/external-imports')
        .set('Authorization', `Bearer ${employeeAToken}`);

      expect(res.status).toBe(403);
    });

    it('Cross-tenant isolation: Tenant B cannot commit Tenant A import', async () => {
      // Create preview in Tenant A
      const uploadRes = await request(app)
        .post('/api/finance/external-imports/upload')
        .set('Authorization', `Bearer ${financeAToken}`)
        .attach('file', Buffer.from(`Date,Account,Description,Debit,Credit\n2026-10-10,Cash,Fund,50,0\n2026-10-10,Equity,Owner,0,50\n`), 'unique_a.csv');

      const importIdA = uploadRes.body.importId;

      // Attempt commit from Tenant B
      const commitRes = await request(app)
        .post(`/api/finance/external-imports/${importIdA}/commit`)
        .set('Authorization', `Bearer ${financeBToken}`)
        .send({ finalizeImmediately: true });

      expect(commitRes.status).toBe(404);
    });
  });
});
