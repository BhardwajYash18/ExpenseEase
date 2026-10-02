const { checkConnection, pool } = require('../src/config/db');

describe('Database Connectivity and Foundational Schema', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('should successfully establish connection and ping PostgreSQL', async () => {
    const status = await checkConnection();
    expect(status.ok).toBe(true);
    expect(status.result).toEqual({ connected: 1 });
  });

  it('should confirm foundational tables exist and no business tables are prematurely created', async () => {
    const res = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
    );
    const tableNames = res.rows.map((r) => r.table_name);

    // Foundational & Checkpoint 3 + 4 + 5 tables must be present
    expect(tableNames).toContain('schema_migrations');
    expect(tableNames).toContain('tenants');
    expect(tableNames).toContain('users');
    expect(tableNames).toContain('receipts');
    expect(tableNames).toContain('receipt_extractions');
    expect(tableNames).toContain('receipt_line_items');
    expect(tableNames).toContain('tenant_policies');
    expect(tableNames).toContain('receipt_validation_results');
    expect(tableNames).toContain('receipt_duplicate_candidates');

    // Strict scope check: No later-stage business tables must exist (deferred to CP6+)
    expect(tableNames).not.toContain('expenses');
    expect(tableNames).not.toContain('approvals');
    expect(tableNames).not.toContain('finance_batches');
    expect(tableNames).not.toContain('journal_entries');
  });
});
