const path = require('path');

// Safe module resolution supporting root and backend execution
let dotenv;
try {
  dotenv = require('dotenv');
} catch (_) {
  dotenv = require('../../backend/node_modules/dotenv');
}

// Load environment configuration from backend/.env
dotenv.config({ path: path.join(__dirname, '../../backend/.env') });
dotenv.config({ path: path.join(__dirname, '../backend/.env') });
dotenv.config({ path: path.join(__dirname, '../../.env') });

const { pool, withTransaction, withTenantContext } = require('../../backend/src/config/db');
const { hashPassword } = require('../../backend/src/services/authService');

const DEMO_TENANT = {
  name: 'ExpensEase Demo',
  slug: 'demo',
  status: 'ACTIVE',
};

const DEMO_USERS = [
  {
    email: 'employee@demo.com',
    password: 'employee123',
    role: 'EMPLOYEE',
    firstName: 'Demo',
    lastName: 'Employee',
  },
  {
    email: 'manager@demo.com',
    password: 'manager123',
    role: 'MANAGER',
    firstName: 'Demo',
    lastName: 'Manager',
  },
  {
    email: 'finance@demo.com',
    password: 'finance123',
    role: 'FINANCE',
    firstName: 'Demo',
    lastName: 'Finance',
  },
];

/**
 * Idempotently seed the dedicated development/demo tenant and its 3 users.
 * - Checks/creates tenant 'demo'
 * - Checks/creates employee@demo.com, manager@demo.com, finance@demo.com
 * - Hashes passwords with bcrypt (SALT_ROUNDS = 12)
 * - Sets tenant context and enforces PostgreSQL RLS
 *
 * @param {object} [customPool] - Optional pg Pool instance
 * @returns {Promise<{ tenant: object, users: Array<object> }>}
 */
async function seedDemo(customPool = null) {
  const activePool = customPool || pool;

  // 1. Idempotently insert or update demo tenant
  let demoTenant;
  const tenantRes = await activePool.query(
    `INSERT INTO tenants (name, slug, status)
     VALUES ($1, $2, $3)
     ON CONFLICT (slug) DO UPDATE
       SET name = EXCLUDED.name, status = EXCLUDED.status, updated_at = CURRENT_TIMESTAMP
     RETURNING id, name, slug, status`,
    [DEMO_TENANT.name, DEMO_TENANT.slug, DEMO_TENANT.status]
  );
  demoTenant = tenantRes.rows[0];

  // 2. Idempotently insert or update demo users under the demo tenant's RLS context
  const seededUsers = [];
  await withTenantContext(demoTenant.id, async (client) => {
    for (const u of DEMO_USERS) {
      const passwordHash = await hashPassword(u.password);

      const userRes = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE')
         ON CONFLICT (tenant_id, email) DO UPDATE
           SET password_hash = EXCLUDED.password_hash,
               first_name = EXCLUDED.first_name,
               last_name = EXCLUDED.last_name,
               role = EXCLUDED.role,
               status = 'ACTIVE',
               updated_at = CURRENT_TIMESTAMP
         RETURNING id, tenant_id, email, role, first_name, last_name, status`,
        [demoTenant.id, u.email, passwordHash, u.firstName, u.lastName, u.role]
      );
      seededUsers.push(userRes.rows[0]);
    }
  });

  return { tenant: demoTenant, users: seededUsers };
}

// Standalone execution handler
if (require.main === module) {
  seedDemo()
    .then((result) => {
      console.log(`Demo tenant ready: ${result.tenant.slug}`);
      for (const u of result.users) {
        console.log(`${u.role}: ${u.email}`);
      }
      return pool.end();
    })
    .catch((err) => {
      console.error('[Seed Error] Failed to seed demo data:', err.message);
      pool.end().finally(() => process.exit(1));
    });
}

module.exports = { seedDemo, DEMO_TENANT, DEMO_USERS };
