const { Pool } = require('pg');
const config = require('./env');

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

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
  checkConnection,
};
