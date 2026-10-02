const { Pool, types } = require('pg');
const config = require('./env');

// Parse PostgreSQL DATE (OID 1082) as YYYY-MM-DD string to avoid timezone shifting
types.setTypeParser(1082, (val) => val);

const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password,
  ssl: config.database.ssl,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  // Unexpected error on idle client
  console.error('[PostgreSQL] Unexpected error on idle client:', err.message);
});

/**
 * Basic connectivity ping
 */
async function checkConnection() {
  let client;
  try {
    client = await pool.connect();
    const res = await client.query('SELECT 1 as connected');
    return { ok: true, result: res.rows[0] };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (client) client.release();
  }
}

/**
 * Executes a callback within a database transaction scoped to a specific tenant.
 * Uses PostgreSQL transaction-local configuration (`set_config(..., true)`) and
 * switches to the unprivileged `expensease_app` role (`SET LOCAL ROLE expensease_app`)
 * ensuring that PostgreSQL Row-Level Security (RLS) is strictly enforced regardless
 * of the connection pool's owner role.
 *
 * Both role and tenant parameters are transaction-local (`SET LOCAL`), ensuring
 * zero context leakage between pooled connections upon COMMIT or ROLLBACK.
 *
 * @param {string} tenantId - UUID of the authenticated tenant
 * @param {Function} callback - Async function receiving the scoped db client
 */
async function withTenantContext(tenantId, callback) {
  if (!tenantId) {
    throw new Error('[Multi-Tenancy] Tenant context requires a valid tenant ID');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Ensure transaction executes under unprivileged app role so RLS is strictly enforced
    await client.query('SET LOCAL ROLE expensease_app');
    // Set transaction-local session parameter. Third argument 'true' scopes to current transaction.
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);

    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[Multi-Tenancy] Error during rollback:', rollbackErr.message);
    }
    throw err;
  } finally {
    // Defense in depth: reset role and tenant parameter before releasing client back to the pool
    try {
      await client.query('RESET ROLE');
      await client.query("SELECT set_config('app.current_tenant_id', '', false)");
    } catch (_) {}
    client.release();
  }
}

/**
 * Executes a callback within a standard database transaction (without tenant RLS context).
 * Suitable for administrative operations such as tenant provisioning.
 *
 * @param {Function} callback - Async function receiving the db client
 */
async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[Database] Error during rollback:', rollbackErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
  checkConnection,
  withTenantContext,
  withTransaction,
};
