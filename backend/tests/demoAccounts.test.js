const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const { pool } = require('../src/config/db');
const config = require('../src/config/env');
const { seedDemo, DEMO_USERS, DEMO_TENANT } = require('../../database/seeds/seedDemo');

describe('Development Test Accounts & RBAC Verification', () => {
  let demoTenantId;
  let employeeToken, managerToken, financeToken;
  let employeeUser, managerUser, financeUser;

  beforeAll(async () => {
    // 1. Execute idempotent seed
    const seedResult = await seedDemo(pool);
    demoTenantId = seedResult.tenant.id;
  });

  afterAll(async () => {
    // Clean up connections if pool open
  });

  describe('1. Seed Idempotency & Tenant Setup', () => {
    it('seeds demo tenant and users idempotently without errors', async () => {
      const secondSeed = await seedDemo(pool);
      expect(secondSeed.tenant.slug).toBe(DEMO_TENANT.slug);
      expect(secondSeed.tenant.id).toBe(demoTenantId);
      expect(secondSeed.users).toHaveLength(3);
    });

    it('confirms all demo users share the exact same demo tenant_id', async () => {
      const { rows } = await pool.query(
        'SELECT id, email, role, tenant_id FROM users WHERE tenant_id = $1',
        [demoTenantId]
      );
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(row.tenant_id).toBe(demoTenantId);
      }
    });
  });

  describe('2. Authentication Flow for Demo Accounts', () => {
    it('authenticates EMPLOYEE (employee@demo.com / employee123 / demo)', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'employee@demo.com',
          password: 'employee123',
          slug: 'demo',
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body.user).toMatchObject({
        email: 'employee@demo.com',
        role: 'EMPLOYEE',
        tenantId: demoTenantId,
      });

      employeeToken = res.body.token;
      employeeUser = res.body.user;

      // Verify JWT claims
      const decoded = jwt.verify(employeeToken, config.auth.jwtSecret);
      expect(decoded.sub).toBe(employeeUser.id);
      expect(decoded.tid).toBe(demoTenantId);
      expect(decoded.role).toBe('EMPLOYEE');
    });

    it('authenticates MANAGER (manager@demo.com / manager123 / demo)', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'manager@demo.com',
          password: 'manager123',
          slug: 'demo',
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body.user).toMatchObject({
        email: 'manager@demo.com',
        role: 'MANAGER',
        tenantId: demoTenantId,
      });

      managerToken = res.body.token;
      managerUser = res.body.user;

      // Verify JWT claims
      const decoded = jwt.verify(managerToken, config.auth.jwtSecret);
      expect(decoded.sub).toBe(managerUser.id);
      expect(decoded.tid).toBe(demoTenantId);
      expect(decoded.role).toBe('MANAGER');
    });

    it('authenticates FINANCE (finance@demo.com / finance123 / demo)', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'finance@demo.com',
          password: 'finance123',
          slug: 'demo',
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body.user).toMatchObject({
        email: 'finance@demo.com',
        role: 'FINANCE',
        tenantId: demoTenantId,
      });

      financeToken = res.body.token;
      financeUser = res.body.user;

      // Verify JWT claims
      const decoded = jwt.verify(financeToken, config.auth.jwtSecret);
      expect(decoded.sub).toBe(financeUser.id);
      expect(decoded.tid).toBe(demoTenantId);
      expect(decoded.role).toBe('FINANCE');
    });

    it('rejects demo accounts with wrong passwords', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'employee@demo.com',
          password: 'wrongpassword',
          slug: 'demo',
        });

      expect(res.status).toBe(401);
      expect(res.body.error?.message).toMatch(/invalid credentials/i);
    });

    it('rejects demo accounts with wrong tenant slug', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'employee@demo.com',
          password: 'employee123',
          slug: 'nonexistent-tenant',
        });

      expect(res.status).toBe(401);
      expect(res.body.error?.message).toMatch(/invalid credentials/i);
    });
  });

  describe('3. Role-Based Access Control (RBAC) Smoke Test', () => {
    const dummyUuid = '00000000-0000-0000-0000-000000000000';

    describe('EMPLOYEE role boundaries', () => {
      it('allows EMPLOYEE to access employee receipts list', async () => {
        const res = await request(app)
          .get('/api/receipts')
          .set('Authorization', `Bearer ${employeeToken}`);

        expect(res.status).toBe(200);
      });

      it('DENIES EMPLOYEE from approving expenses (requires MANAGER)', async () => {
        const res = await request(app)
          .post(`/api/receipts/${dummyUuid}/workflow/approve`)
          .set('Authorization', `Bearer ${employeeToken}`)
          .send({ reason: 'Self-approval attempt' });

        expect(res.status).toBe(403);
      });

      it('DENIES EMPLOYEE from accessing Finance Batches (requires FINANCE)', async () => {
        const res = await request(app)
          .get('/api/finance-batches')
          .set('Authorization', `Bearer ${employeeToken}`);

        expect(res.status).toBe(403);
      });

      it('DENIES EMPLOYEE from creating Finance Batches (requires FINANCE)', async () => {
        const res = await request(app)
          .post('/api/finance-batches')
          .set('Authorization', `Bearer ${employeeToken}`)
          .send({ expense_ids: [dummyUuid] });

        expect(res.status).toBe(403);
      });

      it('DENIES EMPLOYEE from exporting CSV (requires FINANCE)', async () => {
        const res = await request(app)
          .get('/api/export/csv')
          .set('Authorization', `Bearer ${employeeToken}`);

        expect(res.status).toBe(403);
      });
    });

    describe('MANAGER role boundaries', () => {
      it('DENIES MANAGER from accessing Finance Batches (requires FINANCE)', async () => {
        const res = await request(app)
          .get('/api/finance-batches')
          .set('Authorization', `Bearer ${managerToken}`);

        expect(res.status).toBe(403);
      });

      it('DENIES MANAGER from exporting CSV (requires FINANCE)', async () => {
        const res = await request(app)
          .get('/api/export/csv')
          .set('Authorization', `Bearer ${managerToken}`);

        expect(res.status).toBe(403);
      });

      it('DENIES MANAGER from executing QuickBooks integration (requires FINANCE)', async () => {
        const res = await request(app)
          .post(`/api/export/integrations/quickbooks/${dummyUuid}`)
          .set('Authorization', `Bearer ${managerToken}`);

        expect(res.status).toBe(403);
      });
    });

    describe('FINANCE role access', () => {
      it('allows FINANCE to access Finance Batches endpoint', async () => {
        const res = await request(app)
          .get('/api/finance-batches')
          .set('Authorization', `Bearer ${financeToken}`);

        expect(res.status).toBe(200);
      });

      it('allows FINANCE to inspect accounting integrations list', async () => {
        const res = await request(app)
          .get('/api/export/integrations')
          .set('Authorization', `Bearer ${financeToken}`);

        expect(res.status).toBe(200);
      });

      it('allows FINANCE to list eligible approved expenses for batching', async () => {
        const res = await request(app)
          .get('/api/finance-batches/eligible-expenses')
          .set('Authorization', `Bearer ${financeToken}`);

        expect(res.status).toBe(200);
      });
    });
  });
});
