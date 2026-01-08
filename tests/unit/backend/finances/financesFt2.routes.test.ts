// tests/unit/backend/finances/financesFt2.routes.test.ts
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';

describe('Finances FT2 route registration', () => {
  it('exposes GET /api/v1/modules/finances/ft2 with auth enforced', async () => {
    const app = createApp();

    const res = await request(app)
      .get('/api/v1/modules/finances/ft2');

    // 401/403 proves:
    // - route exists
    // - auth middleware is active
    expect([401, 403]).toContain(res.status);
  });
});
