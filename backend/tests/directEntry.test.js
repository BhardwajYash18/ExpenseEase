const request = require('supertest');
const app = require('../src/app');
const { pool, withTransaction } = require('../src/config/db');
const { runMigrations } = require('../../database/migrator');
const authService = require('../src/services/authService');

describe('Feature B: Finance Direct Financial Entries', () => {
  let tenantAId, tenantASlug;
  let tenantBId, tenantBSlug;
  let financeAToken, employeeAToken, managerAToken, financeBToken;
  let financeAId;
  const rawPassword = 'DirectEntrySecurePassword123!';

  beforeAll(async () => {
    await runMigrations(pool);

    const hashedPwd = await authService.hashPassword(rawPassword);
    tenantASlug = `direct-tenant-a-${Date.now()}`;
    tenantBSlug = `direct-tenant-b-${Date.now()}`;

    await withTransaction(async (client) => {
      // 1. Create Tenant A
      const resA = await client.query(
        `INSERT INTO tenants (name, slug, status) VALUES ('Alpha Direct Logistics', $1, 'ACTIVE') RETURNING id`,
        [tenantASlug]
      );
      tenantAId = resA.rows[0].id;

      // 2. Create Tenant B
      const resB = await client.query(
        `INSERT INTO tenants (name, slug, status) VALUES ('Beta Competitor', $1, 'ACTIVE') RETURNING id`,
        [tenantBSlug]
      );
      tenantBId = resB.rows[0].id;

      // 3. Tenant A users
      const finA = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, 'Direct', 'Finance', 'FINANCE') RETURNING id`,
        [tenantAId, `finance.a.${Date.now()}@alpha.com`, hashedPwd]
      );
      financeAId = finA.rows[0].id;

      await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, 'Staff', 'Employee', 'EMPLOYEE') RETURNING id`,
        [tenantAId, `employee.a.${Date.now()}@alpha.com`, hashedPwd]
      );

      await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, 'Lead', 'Manager', 'MANAGER') RETURNING id`,
        [tenantAId, `manager.a.${Date.now()}@alpha.com`, hashedPwd]
      );

      // 4. Tenant B users
      await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, 'DirectB', 'Finance', 'FINANCE') RETURNING id`,
        [tenantBId, `finance.b.${Date.now()}@beta.com`, hashedPwd]
      );
    });

    // Generate tokens
    const loginFinA = await authService.login({
      tenantSlug: tenantASlug,
      email: (await pool.query('SELECT email FROM users WHERE id = $1', [financeAId])).rows[0].email,
      password: rawPassword,
    });
    financeAToken = loginFinA.token;

    const empRow = (await pool.query("SELECT email FROM users WHERE tenant_id = $1 AND role = 'EMPLOYEE'", [tenantAId])).rows[0];
    const loginEmpA = await authService.login({
      tenantSlug: tenantASlug,
      email: empRow.email,
      password: rawPassword,
    });
    employeeAToken = loginEmpA.token;

    const mgrRow = (await pool.query("SELECT email FROM users WHERE tenant_id = $1 AND role = 'MANAGER'", [tenantAId])).rows[0];
    const loginMgrA = await authService.login({
      tenantSlug: tenantASlug,
      email: mgrRow.email,
      password: rawPassword,
    });
    managerAToken = loginMgrA.token;

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

  describe('1. RBAC & Authorization', () => {
    it('rejects unauthenticated requests to direct entries', async () => {
      const res = await request(app)
        .get('/api/finance/direct-entries');
      expect(res.status).toBe(401);
    });

    it('rejects EMPLOYEE role from accessing direct entries', async () => {
      const res = await request(app)
        .get('/api/finance/direct-entries')
        .set('Authorization', `Bearer ${employeeAToken}`);
      expect(res.status).toBe(403);
    });

    it('rejects MANAGER role from accessing direct entries', async () => {
      const res = await request(app)
        .get('/api/finance/direct-entries')
        .set('Authorization', `Bearer ${managerAToken}`);
      expect(res.status).toBe(403);
    });

    it('allows FINANCE role to access direct entries', async () => {
      const res = await request(app)
        .get('/api/finance/direct-entries')
        .set('Authorization', `Bearer ${financeAToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.entries)).toBe(true);
    });
  });

  describe('2. Direct Financial Entry Creation & Validation', () => {
    it('creates a draft direct financial entry without employee reimbursement claim', async () => {
      const payload = {
        transactionDate: '2026-10-15',
        vendor: 'FastHost Cloud Services',
        referenceNumber: 'INV-CLOUD-901',
        sourceType: 'EXTERNAL_INVOICE',
        category: 'Software',
        amount: '450.00',
        taxAmount: '45.00',
        currency: 'USD',
        debitAccount: '6400 - Software & Subscriptions',
        creditAccount: '2000 - Accounts Payable',
        description: 'Dedicated cloud servers for production',
        notes: 'Monthly billing',
        reconciliationStatus: 'UNRECONCILED',
      };

      const res = await request(app)
        .post('/api/finance/direct-entries')
        .set('Authorization', `Bearer ${financeAToken}`)
        .field('transactionDate', payload.transactionDate)
        .field('vendor', payload.vendor)
        .field('referenceNumber', payload.referenceNumber)
        .field('sourceType', payload.sourceType)
        .field('category', payload.category)
        .field('amount', payload.amount)
        .field('taxAmount', payload.taxAmount)
        .field('currency', payload.currency)
        .field('debitAccount', payload.debitAccount)
        .field('creditAccount', payload.creditAccount)
        .field('description', payload.description)
        .field('notes', payload.notes)
        .field('reconciliationStatus', payload.reconciliationStatus);

      expect(res.status).toBe(201);
      expect(res.body.directEntry).toBeDefined();
      expect(res.body.directEntry.status).toBe('DRAFT');
      expect(res.body.directEntry.vendor).toBe('FastHost Cloud Services');
      expect(res.body.directEntry.amount).toBe(450);
      expect(res.body.directEntry.entryNumber).toMatch(/^DE-\d+/);

      // Verify that NO employee reimbursement claim or receipt was created
      const { rows: wfRows } = await pool.query(
        'SELECT * FROM expense_workflows WHERE tenant_id = $1',
        [tenantAId]
      );
      expect(wfRows.length).toBe(0);
    });

    it('rejects direct entry creation with missing required fields', async () => {
      const res = await request(app)
        .post('/api/finance/direct-entries')
        .set('Authorization', `Bearer ${financeAToken}`)
        .field('transactionDate', '2026-10-15')
        .field('amount', '100.00'); // missing vendor, debit, credit, description

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('rejects direct entry creation with non-positive amount', async () => {
      const res = await request(app)
        .post('/api/finance/direct-entries')
        .set('Authorization', `Bearer ${financeAToken}`)
        .field('transactionDate', '2026-10-15')
        .field('vendor', 'Negative Corp')
        .field('debitAccount', '6900 - General Expense')
        .field('creditAccount', '2000 - Accounts Payable')
        .field('description', 'Test description')
        .field('amount', '-50.00');

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/amount must be a valid positive number/i);
    });

    it('prevents duplicate entries with same vendor and referenceNumber within tenant', async () => {
      const res = await request(app)
        .post('/api/finance/direct-entries')
        .set('Authorization', `Bearer ${financeAToken}`)
        .field('transactionDate', '2026-10-15')
        .field('vendor', 'FastHost Cloud Services')
        .field('referenceNumber', 'INV-CLOUD-901') // duplicate reference
        .field('amount', '200.00')
        .field('debitAccount', '6400 - Software')
        .field('creditAccount', '2000 - Accounts Payable')
        .field('description', 'Duplicate test invoice');

      expect(res.status).toBe(409);
      expect(res.body.error.message).toMatch(/duplicate entry/i);
    });
  });

  describe('3. Supporting Document Attachment Upload & Retrieval', () => {
    it('uploads a supporting bill document and allows streaming it back', async () => {
      const dummyImage = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      );

      const res = await request(app)
        .post('/api/finance/direct-entries')
        .set('Authorization', `Bearer ${financeAToken}`)
        .field('transactionDate', '2026-10-18')
        .field('vendor', 'Office MegaStore')
        .field('referenceNumber', 'BILL-OMS-774')
        .field('amount', '320.50')
        .field('debitAccount', '6300 - Office Supplies')
        .field('creditAccount', '2000 - Accounts Payable')
        .field('description', 'Ergonomic chairs and desks')
        .attach('attachment', dummyImage, 'invoice_scan.png');

      expect(res.status).toBe(201);
      const entryId = res.body.directEntry.id;
      expect(res.body.directEntry.hasAttachment).toBe(true);
      expect(res.body.directEntry.attachmentFilename).toBe('invoice_scan.png');

      // Fetch attachment
      const getRes = await request(app)
        .get(`/api/finance/direct-entries/${entryId}/attachment`)
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.headers['content-type']).toBe('image/png');
      expect(getRes.body).toBeInstanceOf(Buffer);
    });
  });

  describe('4. Posting to General Ledger & Journal Entry Generation', () => {
    let draftEntryId;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/finance/direct-entries')
        .set('Authorization', `Bearer ${financeAToken}`)
        .field('transactionDate', '2026-10-20')
        .field('vendor', 'City Power & Electric')
        .field('referenceNumber', 'ELEC-2026-10')
        .field('amount', '780.00')
        .field('debitAccount', '6900 - Miscellaneous / Other Expense')
        .field('creditAccount', '2000 - Accounts Payable')
        .field('description', 'Monthly facility power bill');

      draftEntryId = res.body.directEntry.id;
    });

    it('posts draft entry to GL and creates a balanced double-entry Journal Entry', async () => {
      const postRes = await request(app)
        .post(`/api/finance/direct-entries/${draftEntryId}/post`)
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(postRes.status).toBe(200);
      expect(postRes.body.status).toBe('POSTED');
      expect(postRes.body.journalEntryId).toBeDefined();

      const journalEntryId = postRes.body.journalEntryId;

      // Verify Journal Entry in database
      const { rows: jeRows } = await pool.query(
        'SELECT * FROM journal_entries WHERE id = $1',
        [journalEntryId]
      );
      expect(jeRows.length).toBe(1);
      const je = jeRows[0];
      expect(je.status).toBe('FINALIZED');
      expect(je.source_type).toBe('DIRECT_ENTRY');
      expect(Number(je.total_debit)).toBe(780);
      expect(Number(je.total_credit)).toBe(780);
      expect(je.line_count).toBe(2);

      // Verify Journal Entry Lines
      const { rows: lineRows } = await pool.query(
        'SELECT * FROM journal_entry_lines WHERE journal_entry_id = $1 ORDER BY line_order ASC',
        [journalEntryId]
      );
      expect(lineRows.length).toBe(2);
      expect(lineRows[0].account).toBe('6900 - Miscellaneous / Other Expense');
      expect(Number(lineRows[0].debit_amount)).toBe(780);
      expect(Number(lineRows[0].credit_amount)).toBe(0);

      expect(lineRows[1].account).toBe('2000 - Accounts Payable');
      expect(Number(lineRows[1].debit_amount)).toBe(0);
      expect(Number(lineRows[1].credit_amount)).toBe(780);

      // Verify Direct Entry detail shows audit history
      const detailRes = await request(app)
        .get(`/api/finance/direct-entries/${draftEntryId}`)
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(detailRes.status).toBe(200);
      expect(detailRes.body.directEntry.status).toBe('POSTED');
      expect(detailRes.body.directEntry.journalEntryId).toBe(journalEntryId);
      expect(detailRes.body.directEntry.auditHistory.length).toBeGreaterThanOrEqual(2);
      expect(detailRes.body.directEntry.auditHistory.some((a) => a.action === 'CREATE')).toBe(true);
      expect(detailRes.body.directEntry.auditHistory.some((a) => a.action === 'POST')).toBe(true);
    });

    it('rejects re-posting an already posted direct entry', async () => {
      const res = await request(app)
        .post(`/api/finance/direct-entries/${draftEntryId}/post`)
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/cannot post entry in 'POSTED' status/i);
    });
  });

  describe('5. Multi-Tenant Isolation', () => {
    let tenantAEntryId;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/finance/direct-entries')
        .set('Authorization', `Bearer ${financeAToken}`)
        .field('transactionDate', '2026-10-21')
        .field('vendor', 'Confidential Vendor A')
        .field('amount', '999.00')
        .field('debitAccount', '6900 - Miscellaneous')
        .field('creditAccount', '2000 - Accounts Payable')
        .field('description', 'Confidential R&D component');

      tenantAEntryId = res.body.directEntry.id;
    });

    it('prevents Tenant B from viewing Tenant A direct entries in list', async () => {
      const res = await request(app)
        .get('/api/finance/direct-entries')
        .set('Authorization', `Bearer ${financeBToken}`);

      expect(res.status).toBe(200);
      const found = res.body.entries.find((e) => e.id === tenantAEntryId);
      expect(found).toBeUndefined();
    });

    it('prevents Tenant B from viewing Tenant A direct entry by ID', async () => {
      const res = await request(app)
        .get(`/api/finance/direct-entries/${tenantAEntryId}`)
        .set('Authorization', `Bearer ${financeBToken}`);

      expect(res.status).toBe(404);
    });

    it('prevents Tenant B from posting Tenant A direct entry', async () => {
      const res = await request(app)
        .post(`/api/finance/direct-entries/${tenantAEntryId}/post`)
        .set('Authorization', `Bearer ${financeBToken}`);

      expect(res.status).toBe(404);
    });
  });
});
