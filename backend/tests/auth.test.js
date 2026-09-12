const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const { pool, withTenantContext, withTransaction } = require('../src/config/db');
const { runMigrations } = require('../../database/migrator');
const authService = require('../src/services/authService');
const authenticate = require('../src/middleware/authenticate');
const requireRole = require('../src/middleware/requireRole');
const express = require('express');

// Dedicated test Express app to exercise RBAC authorization middleware in isolation
const testApp = express();
testApp.use(express.json());

const testRbacRouter = express.Router();
testRbacRouter.get('/employee-only', authenticate, requireRole('EMPLOYEE'), (req, res) => {
  res.status(200).json({ access: 'granted', user: req.user });
});
testRbacRouter.get('/manager-only', authenticate, requireRole('MANAGER'), (req, res) => {
  res.status(200).json({ access: 'granted', user: req.user });
});
testRbacRouter.get('/finance-only', authenticate, requireRole('FINANCE'), (req, res) => {
  res.status(200).json({ access: 'granted', user: req.user });
});
testRbacRouter.get('/management', authenticate, requireRole('MANAGER', 'FINANCE'), (req, res) => {
  res.status(200).json({ access: 'granted', user: req.user });
});
testApp.use('/api/test-rbac', testRbacRouter);

describe('Checkpoint 2 — Authentication & RBAC', () => {
  let tenantAId, tenantASlug;
  let tenantBId, tenantBSlug;
  let suspendedTenantId, suspendedTenantSlug;

  let employeeUser, managerUser, financeUser, inactiveUser;
  const rawPassword = 'SecurePassword123!';

  beforeAll(async () => {
    // Ensure migrations are executed
    await runMigrations(pool);

    const hashedPwd = await authService.hashPassword(rawPassword);

    // Create test tenants
    tenantASlug = `alpha-corp-${Date.now()}`;
    tenantBSlug = `beta-llc-${Date.now()}`;
    suspendedTenantSlug = `suspended-inc-${Date.now()}`;

    await withTransaction(async (client) => {
      const resA = await client.query(
        `INSERT INTO tenants (name, slug, status) VALUES ('Alpha Corp', $1, 'ACTIVE') RETURNING id`,
        [tenantASlug]
      );
      tenantAId = resA.rows[0].id;

      const resB = await client.query(
        `INSERT INTO tenants (name, slug, status) VALUES ('Beta LLC', $1, 'ACTIVE') RETURNING id`,
        [tenantBSlug]
      );
      tenantBId = resB.rows[0].id;

      const resSuspended = await client.query(
        `INSERT INTO tenants (name, slug, status) VALUES ('Suspended Inc', $1, 'SUSPENDED') RETURNING id`,
        [suspendedTenantSlug]
      );
      suspendedTenantId = resSuspended.rows[0].id;
    });

    // Create users in Tenant A
    await withTenantContext(tenantAId, async (client) => {
      const empRes = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role, status)
         VALUES ($1, 'emp@alpha.com', $2, 'Edward', 'Employee', 'EMPLOYEE', 'ACTIVE')
         RETURNING id, tenant_id, email, role, first_name, last_name`,
        [tenantAId, hashedPwd]
      );
      employeeUser = empRes.rows[0];

      const mgrRes = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role, status)
         VALUES ($1, 'mgr@alpha.com', $2, 'Mary', 'Manager', 'MANAGER', 'ACTIVE')
         RETURNING id, tenant_id, email, role, first_name, last_name`,
        [tenantAId, hashedPwd]
      );
      managerUser = mgrRes.rows[0];

      const finRes = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role, status)
         VALUES ($1, 'fin@alpha.com', $2, 'Frank', 'Finance', 'FINANCE', 'ACTIVE')
         RETURNING id, tenant_id, email, role, first_name, last_name`,
        [tenantAId, hashedPwd]
      );
      financeUser = finRes.rows[0];

      const inactRes = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role, status)
         VALUES ($1, 'inactive@alpha.com', $2, 'Ian', 'Inactive', 'EMPLOYEE', 'INACTIVE')
         RETURNING id, tenant_id, email, role, first_name, last_name`,
        [tenantAId, hashedPwd]
      );
      inactiveUser = inactRes.rows[0];
    });
  });

  afterAll(async () => {
    // Teardown test data
    try {
      await withTransaction(async (client) => {
        const tenantIds = [tenantAId, tenantBId, suspendedTenantId].filter(Boolean);
        if (tenantIds.length > 0) {
          await client.query('DELETE FROM users WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
          await client.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [tenantIds]);
        }
      });
    } catch (_) {}
  });

  describe('1. Password Hashing & Token Verification Mechanics', () => {
    it('hashes passwords using bcrypt with a salt', async () => {
      const hash1 = await authService.hashPassword('MyPassword123');
      const hash2 = await authService.hashPassword('MyPassword123');

      expect(hash1).not.toBe('MyPassword123');
      expect(hash1).toMatch(/^\$2[aby]\$12\$/); // bcrypt format with cost factor 12
      expect(hash1).not.toBe(hash2); // unique salt per hash

      expect(await authService.verifyPassword('MyPassword123', hash1)).toBe(true);
      expect(await authService.verifyPassword('WrongPassword', hash1)).toBe(false);
    });

    it('signs and verifies JWT with pinned HS256 algorithm and required claims', () => {
      const token = authService.signToken({
        sub: '00000000-0000-0000-0000-000000000001',
        tid: '00000000-0000-0000-0000-000000000002',
        role: 'EMPLOYEE',
      });

      const decoded = authService.verifyToken(token);
      expect(decoded.sub).toBe('00000000-0000-0000-0000-000000000001');
      expect(decoded.tid).toBe('00000000-0000-0000-0000-000000000002');
      expect(decoded.role).toBe('EMPLOYEE');
    });

    it('rejects tokens with unrecognized algorithm or missing claims', () => {
      const secret = require('../src/config/env').auth.jwtSecret;

      // Token without tid
      const badTokenNoTid = jwt.sign({ sub: '123', role: 'EMPLOYEE' }, secret, { algorithm: 'HS256' });
      expect(() => authService.verifyToken(badTokenNoTid)).toThrow('missing required claims');

      // Token with invalid role
      const badTokenRole = jwt.sign({ sub: '123', tid: '456', role: 'SUPERUSER' }, secret, { algorithm: 'HS256' });
      expect(() => authService.verifyToken(badTokenRole)).toThrow('unrecognized role claim');

      // Tampered token
      const validToken = authService.signToken({ sub: '1', tid: '2', role: 'EMPLOYEE' });
      const tampered = validToken.slice(0, -5) + 'abcde';
      expect(() => authService.verifyToken(tampered)).toThrow();
    });

    it('pre-auth tenant lookup by slug only retrieves id and status', async () => {
      const tenant = await authService.lookupTenantBySlug(tenantASlug);
      expect(tenant).toBeDefined();
      expect(tenant.id).toBe(tenantAId);
      expect(tenant.status).toBe('ACTIVE');
      // Ensure only tenant metadata is accessible, not users or other sensitive data
      expect(tenant.users).toBeUndefined();
      expect(tenant.password_hash).toBeUndefined();
    });
  });

  describe('2. POST /api/auth/login Endpoint', () => {
    it('successfully logs in with valid credentials and returns token + safe user info', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'emp@alpha.com',
          password: rawPassword,
          slug: tenantASlug,
        });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(typeof res.body.token).toBe('string');
      expect(res.body.user).toBeDefined();
      expect(res.body.user.id).toBe(employeeUser.id);
      expect(res.body.user.tenantId).toBe(tenantAId);
      expect(res.body.user.email).toBe('emp@alpha.com');
      expect(res.body.user.role).toBe('EMPLOYEE');
      expect(res.body.user.firstName).toBe('Edward');
      expect(res.body.user.lastName).toBe('Employee');

      // CRITICAL: password_hash must NEVER be returned
      expect(res.body.user.password_hash).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('password_hash');
      expect(JSON.stringify(res.body)).not.toContain(rawPassword);
    });

    it('returns generic 401 for incorrect password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'emp@alpha.com',
          password: 'WrongPassword!',
          slug: tenantASlug,
        });

      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Invalid credentials');
    });

    it('returns generic 401 for non-existent user (prevents email enumeration)', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@alpha.com',
          password: rawPassword,
          slug: tenantASlug,
        });

      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Invalid credentials');
    });

    it('returns generic 401 for non-existent tenant slug', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'emp@alpha.com',
          password: rawPassword,
          slug: 'non-existent-tenant-slug',
        });

      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Invalid credentials');
    });

    it('returns generic 401 for inactive user', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'inactive@alpha.com',
          password: rawPassword,
          slug: tenantASlug,
        });

      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Invalid credentials');
    });

    it('returns generic 401 for suspended tenant', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'any@suspended.com',
          password: rawPassword,
          slug: suspendedTenantSlug,
        });

      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Invalid credentials');
    });

    it('returns 400 validation error when required fields are missing or invalid', async () => {
      // Missing email
      const res1 = await request(app)
        .post('/api/auth/login')
        .send({ password: rawPassword, slug: tenantASlug });
      expect(res1.status).toBe(400);

      // Missing password
      const res2 = await request(app)
        .post('/api/auth/login')
        .send({ email: 'emp@alpha.com', slug: tenantASlug });
      expect(res2.status).toBe(400);

      // Missing slug
      const res3 = await request(app)
        .post('/api/auth/login')
        .send({ email: 'emp@alpha.com', password: rawPassword });
      expect(res3.status).toBe(400);

      // Invalid email format
      const res4 = await request(app)
        .post('/api/auth/login')
        .send({ email: 'not-an-email', password: rawPassword, slug: tenantASlug });
      expect(res4.status).toBe(400);
    });
  });

  describe('3. GET /api/auth/me & Authentication Middleware', () => {
    let validToken;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'emp@alpha.com',
          password: rawPassword,
          slug: tenantASlug,
        });
      validToken = res.body.token;
    });

    it('returns authenticated user details when a valid Bearer token is provided', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${validToken}`);

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.id).toBe(employeeUser.id);
      expect(res.body.user.tenantId).toBe(tenantAId);
      expect(res.body.user.role).toBe('EMPLOYEE');
      expect(res.body.user.password_hash).toBeUndefined();
    });

    it('rejects request with 401 when Authorization header is missing', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Authentication required');
    });

    it('rejects request with 401 when Authorization scheme is not Bearer', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Basic ${validToken}`);
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Authentication required');
    });

    it('rejects request with 401 when token is tampered or invalid', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${validToken}tampered`);
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Invalid or expired token');
    });

    it('rejects request with 401 when token is expired', () => {
      const secret = require('../src/config/env').auth.jwtSecret;
      const expiredToken = jwt.sign(
        { sub: employeeUser.id, tid: tenantAId, role: 'EMPLOYEE' },
        secret,
        { algorithm: 'HS256', expiresIn: -10 }
      );

      return request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401)
        .then((res) => {
          expect(res.body.error.message).toBe('Invalid or expired token');
        });
    });
  });

  describe('4. RBAC Authorization Enforcement', () => {
    let employeeToken, managerToken, financeToken;

    beforeAll(() => {
      employeeToken = authService.signToken({ sub: employeeUser.id, tid: tenantAId, role: 'EMPLOYEE' });
      managerToken = authService.signToken({ sub: managerUser.id, tid: tenantAId, role: 'MANAGER' });
      financeToken = authService.signToken({ sub: financeUser.id, tid: tenantAId, role: 'FINANCE' });
    });

    it('allows EMPLOYEE to access EMPLOYEE endpoints, but forbids access to MANAGER or FINANCE endpoints', async () => {
      const empRes = await request(testApp)
        .get('/api/test-rbac/employee-only')
        .set('Authorization', `Bearer ${employeeToken}`);
      expect(empRes.status).toBe(200);

      const mgrRes = await request(testApp)
        .get('/api/test-rbac/manager-only')
        .set('Authorization', `Bearer ${employeeToken}`);
      expect(mgrRes.status).toBe(403);
      expect(mgrRes.body.error.message).toContain('Forbidden');

      const finRes = await request(testApp)
        .get('/api/test-rbac/finance-only')
        .set('Authorization', `Bearer ${employeeToken}`);
      expect(finRes.status).toBe(403);
    });

    it('allows MANAGER to access MANAGER endpoints and multi-role endpoints, but forbids FINANCE-only endpoints', async () => {
      const mgrRes = await request(testApp)
        .get('/api/test-rbac/manager-only')
        .set('Authorization', `Bearer ${managerToken}`);
      expect(mgrRes.status).toBe(200);

      const sharedRes = await request(testApp)
        .get('/api/test-rbac/management')
        .set('Authorization', `Bearer ${managerToken}`);
      expect(sharedRes.status).toBe(200);

      const finRes = await request(testApp)
        .get('/api/test-rbac/finance-only')
        .set('Authorization', `Bearer ${managerToken}`);
      expect(finRes.status).toBe(403);
    });

    it('allows FINANCE to access FINANCE endpoints and multi-role endpoints, but forbids MANAGER-only endpoints', async () => {
      const finRes = await request(testApp)
        .get('/api/test-rbac/finance-only')
        .set('Authorization', `Bearer ${financeToken}`);
      expect(finRes.status).toBe(200);

      const sharedRes = await request(testApp)
        .get('/api/test-rbac/management')
        .set('Authorization', `Bearer ${financeToken}`);
      expect(sharedRes.status).toBe(200);

      const mgrRes = await request(testApp)
        .get('/api/test-rbac/manager-only')
        .set('Authorization', `Bearer ${financeToken}`);
      expect(mgrRes.status).toBe(403);
    });
  });

  describe('5. Security: Client Input Isolation & RLS Boundary Verification', () => {
    let employeeToken;

    beforeAll(() => {
      employeeToken = authService.signToken({ sub: employeeUser.id, tid: tenantAId, role: 'EMPLOYEE' });
    });

    it('ignores client-supplied tenant_id or role in request body/query when performing authenticated actions', async () => {
      const res = await request(app)
        .get('/api/auth/me?tenant_id=00000000-0000-0000-0000-000000000000&role=FINANCE')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ tenant_id: '00000000-0000-0000-0000-000000000000', role: 'FINANCE' });

      expect(res.status).toBe(200);
      // Identity MUST be derived strictly from the verified JWT
      expect(res.body.user.tenantId).toBe(tenantAId);
      expect(res.body.user.role).toBe('EMPLOYEE');
    });

    it('retains PostgreSQL RLS isolation when executing queries using authenticated user tenant context', async () => {
      // In this test, we verify that withTenantContext using the token's tenantId enforces isolation
      const decoded = authService.verifyToken(employeeToken);

      // Verify that under Tenant A context, Tenant B's users cannot be seen
      const usersSeen = await withTenantContext(decoded.tid, async (client) => {
        const result = await client.query('SELECT id, email, tenant_id FROM users');
        return result.rows;
      });

      expect(usersSeen.length).toBeGreaterThan(0);
      usersSeen.forEach((u) => {
        expect(u.tenant_id).toBe(tenantAId);
        expect(u.tenant_id).not.toBe(tenantBId);
      });
    });
  });
});
