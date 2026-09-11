const request = require('supertest');
const app = require('../src/app');
const { pool } = require('../src/config/db');

describe('Readiness Check Endpoint', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('GET /api/health/ready should return clear dependency status without throwing', async () => {
    const res = await request(app).get('/api/health/ready');
    // May be 200 (if ai-service is running) or 503 (if ai-service is not running yet)
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('dependencies');
    expect(res.body.dependencies).toHaveProperty('database');
    expect(res.body.dependencies.database.status).toBe('connected');
    expect(res.body.dependencies).toHaveProperty('aiService');
  });
});
