const request = require('supertest');
const app = require('../src/app');

describe('Health and Foundation Endpoints', () => {
  it('GET /api/health should return 200 with status "ok"', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /api/unknown-route should return 404', async () => {
    const res = await request(app).get('/api/unknown-route');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});
