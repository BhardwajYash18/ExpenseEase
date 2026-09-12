const fs = require('fs');
const path = require('path');

// Safe module resolution supporting both direct node execution and Jest test runners
let pg;
try {
  pg = require('pg');
} catch (_) {
  pg = require('../backend/node_modules/pg');
}
const { Pool } = pg;

let dotenv;
try {
  dotenv = require('dotenv');
} catch (_) {
  dotenv = require('../backend/node_modules/dotenv');
}

// Load environment configuration
dotenv.config({ path: path.join(__dirname, '../backend/.env') });
dotenv.config({ path: path.join(__dirname, '../.env') });

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'expensease_db',
  user: process.env.DB_USER || 'expensease_user',
  password: process.env.DB_PASSWORD || 'expensease_secure_password',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
};

async function runMigrations(customPool = null) {
  const pool = customPool || new Pool(dbConfig);
  const client = await pool.connect();

  try {
    // 1. Ensure migration tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        version VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Query applied migrations
    const { rows: appliedRows } = await client.query(
      'SELECT version FROM schema_migrations ORDER BY id ASC'
    );
    const appliedVersions = new Set(appliedRows.map((r) => r.version));

    // 3. Read migration files from directory
    const migrationsDir = path.join(__dirname, 'migrations');
    if (!fs.existsSync(migrationsDir)) {
      console.log('[Migration] Migrations directory does not exist.');
      return { appliedCount: 0, totalPending: 0 };
    }

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const pending = files.filter((f) => !appliedVersions.has(f));

    if (pending.length === 0) {
      console.log('[Migration] No pending migrations. Schema is up to date.');
      return { appliedCount: 0, totalPending: 0 };
    }

    console.log(`[Migration] Found ${pending.length} pending migration(s).`);

    let appliedCount = 0;
    for (const file of pending) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      console.log(`[Migration] Applying: ${file}...`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1)',
          [file]
        );
        await client.query('COMMIT');
        console.log(`[Migration] Successfully applied: ${file}`);
        appliedCount++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[Migration] Failed applying ${file}:`, err.message);
        throw err;
      }
    }

    return { appliedCount, totalPending: pending.length };
  } finally {
    client.release();
    if (!customPool) {
      await pool.end();
    }
  }
}

// Support CLI execution
if (require.main === module) {
  runMigrations()
    .then(({ appliedCount }) => {
      console.log(`[Migration] Execution completed. Applied ${appliedCount} migration(s).`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Migration] Migration process failed:', err);
      process.exit(1);
    });
}

module.exports = { runMigrations, dbConfig };
