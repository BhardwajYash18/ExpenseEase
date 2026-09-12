const { pool, withTenantContext, withTransaction } = require('../src/config/db');
const { runMigrations } = require('../../database/migrator');

describe('Checkpoint 1 — Multi-Tenancy & Row-Level Security (RLS)', () => {
  let tenantAId;
  let tenantBId;
  let userAId;
  let userBId;

  beforeAll(async () => {
    // 1. Run migrations deterministically
    await runMigrations(pool);

    // 2. Create isolated test tenants using administrative transaction (outside tenant context)
    await withTransaction(async (client) => {
      const resA = await client.query(
        `INSERT INTO tenants (name, slug) 
         VALUES ('Tenant Alpha Corp', 'tenant-alpha-' || substr(gen_random_uuid()::text, 1, 8))
         RETURNING id`
      );
      tenantAId = resA.rows[0].id;

      const resB = await client.query(
        `INSERT INTO tenants (name, slug) 
         VALUES ('Tenant Beta LLC', 'tenant-beta-' || substr(gen_random_uuid()::text, 1, 8))
         RETURNING id`
      );
      tenantBId = resB.rows[0].id;
    });

    // 3. Create users under each tenant's context
    await withTenantContext(tenantAId, async (client) => {
      const res = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, 'alice@alpha.com', 'hash_mock_alice', 'Alice', 'Alpha', 'EMPLOYEE')
         RETURNING id`,
        [tenantAId]
      );
      userAId = res.rows[0].id;
    });

    await withTenantContext(tenantBId, async (client) => {
      const res = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, 'bob@beta.com', 'hash_mock_bob', 'Bob', 'Beta', 'MANAGER')
         RETURNING id`,
        [tenantBId]
      );
      userBId = res.rows[0].id;
    });
  });

  afterAll(async () => {
    // Clean up test data
    try {
      await withTransaction(async (client) => {
        if (tenantAId || tenantBId) {
          await client.query(
            'DELETE FROM users WHERE tenant_id IN ($1, $2)',
            [tenantAId, tenantBId]
          );
          await client.query(
            'DELETE FROM tenants WHERE id IN ($1, $2)',
            [tenantAId, tenantBId]
          );
        }
      });
    } catch (_) {}
    await pool.end();
  });

  describe('1. Migration Tracking & Idempotency', () => {
    it('should have schema_migrations table recording applied migrations', async () => {
      const { rows } = await pool.query(
        'SELECT version, applied_at FROM schema_migrations WHERE version = $1',
        ['001_create_tenants_and_users.sql']
      );
      expect(rows.length).toBe(1);
      expect(rows[0].version).toBe('001_create_tenants_and_users.sql');
      expect(rows[0].applied_at).toBeDefined();
    });

    it('should be idempotent and not re-apply existing migrations', async () => {
      const result = await runMigrations(pool);
      expect(result.appliedCount).toBe(0);
      expect(result.totalPending).toBe(0);
    });
  });

  describe('2. RLS Catalog Verification', () => {
    it('should have ROW LEVEL SECURITY enabled and FORCED on users table', async () => {
      const { rows } = await pool.query(
        `SELECT relrowsecurity, relforcerowsecurity 
         FROM pg_class 
         WHERE relname = 'users'`
      );
      expect(rows.length).toBe(1);
      expect(rows[0].relrowsecurity).toBe(true);
      expect(rows[0].relforcerowsecurity).toBe(true);
    });

    it('should have tenant_isolation_policy declared on users table', async () => {
      const { rows } = await pool.query(
        `SELECT policyname, tablename, cmd, qual, with_check 
         FROM pg_policies 
         WHERE tablename = 'users' AND policyname = 'tenant_isolation_policy'`
      );
      expect(rows.length).toBe(1);
      expect(rows[0].cmd).toBe('ALL');
      expect(rows[0].qual).toContain('app.current_tenant_id');
      expect(rows[0].with_check).toContain('app.current_tenant_id');
    });
  });

  describe('3. Multi-Tenant Isolation & Read Restrictions', () => {
    it('Tenant A should see its own user', async () => {
      await withTenantContext(tenantAId, async (client) => {
        const { rows } = await client.query('SELECT id, email, tenant_id FROM users');
        const userIds = rows.map((r) => r.id);
        expect(userIds).toContain(userAId);
        expect(userIds).not.toContain(userBId);
      });
    });

    it('Tenant B should see its own user', async () => {
      await withTenantContext(tenantBId, async (client) => {
        const { rows } = await client.query('SELECT id, email, tenant_id FROM users');
        const userIds = rows.map((r) => r.id);
        expect(userIds).toContain(userBId);
        expect(userIds).not.toContain(userAId);
      });
    });

    it('Tenant A CANNOT see Tenant B user even if explicitly queried by ID', async () => {
      await withTenantContext(tenantAId, async (client) => {
        const { rows } = await client.query('SELECT * FROM users WHERE id = $1', [userBId]);
        expect(rows).toEqual([]);
      });
    });

    it('A session without tenant context CANNOT see any users (RLS blocks access)', async () => {
      const client = await pool.connect();
      try {
        await client.query('SET ROLE expensease_app');
        const { rows } = await client.query('SELECT * FROM users');
        expect(rows).toEqual([]);
      } finally {
        await client.query('RESET ROLE');
        client.release();
      }
    });
  });

  describe('4. Multi-Tenant Modification & Delete Restrictions', () => {
    it('Tenant A CANNOT update Tenant B user', async () => {
      await withTenantContext(tenantAId, async (client) => {
        const result = await client.query(
          "UPDATE users SET first_name = 'Hacked' WHERE id = $1",
          [userBId]
        );
        expect(result.rowCount).toBe(0);
      });

      // Verify Bob was untouched
      await withTenantContext(tenantBId, async (client) => {
        const { rows } = await client.query('SELECT first_name FROM users WHERE id = $1', [userBId]);
        expect(rows[0].first_name).toBe('Bob');
      });
    });

    it('Tenant A CANNOT delete Tenant B user', async () => {
      await withTenantContext(tenantAId, async (client) => {
        const result = await client.query('DELETE FROM users WHERE id = $1', [userBId]);
        expect(result.rowCount).toBe(0);
      });

      // Verify Bob still exists
      await withTenantContext(tenantBId, async (client) => {
        const { rows } = await client.query('SELECT id FROM users WHERE id = $1', [userBId]);
        expect(rows.length).toBe(1);
      });
    });

    it('Tenant A CANNOT insert a user belonging to Tenant B (WITH CHECK violation)', async () => {
      await expect(
        withTenantContext(tenantAId, async (client) => {
          await client.query(
            `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name)
             VALUES ($1, 'intruder@beta.com', 'hash', 'Intruder', 'X')`,
            [tenantBId]
          );
        })
      ).rejects.toThrow(/new row violates row-level security policy/i);
    });
  });

  describe('5. Database Constraints', () => {
    it('should reject creating a user with null tenant_id', async () => {
      await expect(
        withTransaction(async (client) => {
          await client.query(
            `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name)
             VALUES (NULL, 'notenant@example.com', 'hash', 'No', 'Tenant')`
          );
        })
      ).rejects.toThrow(/null value in column "tenant_id"/i);
    });

    it('should reject creating a user with non-existent tenant_id (foreign key constraint)', async () => {
      const nonExistentTenantId = '00000000-0000-0000-0000-000000000000';
      await expect(
        withTransaction(async (client) => {
          await client.query(
            `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name)
             VALUES ($1, 'ghost@example.com', 'hash', 'Ghost', 'User')`,
            [nonExistentTenantId]
          );
        })
      ).rejects.toThrow(/violates foreign key constraint/i);
    });

    it('should reject duplicate email within the same tenant', async () => {
      await expect(
        withTenantContext(tenantAId, async (client) => {
          await client.query(
            `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name)
             VALUES ($1, 'alice@alpha.com', 'hash2', 'Alice2', 'Alpha2')`,
            [tenantAId]
          );
        })
      ).rejects.toThrow(/duplicate key value violates unique constraint/i);
    });

    it('should reject deleting a tenant when active users exist (ON DELETE RESTRICT)', async () => {
      await expect(
        withTransaction(async (client) => {
          await client.query('DELETE FROM tenants WHERE id = $1', [tenantAId]);
        })
      ).rejects.toThrow(/violates foreign key constraint/i);
    });
  });

  describe('6. Connection Pool Tenant Context Isolation', () => {
    it('consecutive transactions on pooled connections must NOT leak prior tenant context', async () => {
      // Run in Tenant A context
      await withTenantContext(tenantAId, async (client) => {
        const { rows } = await client.query('SELECT current_setting(\'app.current_tenant_id\', true) as val');
        expect(rows[0].val).toBe(tenantAId);
      });

      // Next query on arbitrary client from pool without context must NOT have tenantAId
      const directClient = await pool.connect();
      try {
        const { rows } = await directClient.query('SELECT current_setting(\'app.current_tenant_id\', true) as val');
        expect(rows[0].val === '' || rows[0].val === null).toBe(true);
      } finally {
        directClient.release();
      }
    });
  });
});
