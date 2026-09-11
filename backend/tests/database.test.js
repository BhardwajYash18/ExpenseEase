const { checkConnection, pool } = require('../src/config/db');

describe('Database Connectivity Verification (Checkpoint 0)', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('should successfully establish connection and ping PostgreSQL', async () => {
    const status = await checkConnection();
    expect(status.ok).toBe(true);
    expect(status.result).toEqual({ connected: 1 });
  });

  it('should confirm that NO application tables exist in the public schema at Checkpoint 0', async () => {
    const res = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
    );
    expect(res.rows).toEqual([]);
  });
});
