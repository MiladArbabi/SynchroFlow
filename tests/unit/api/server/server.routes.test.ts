// tests/unit/api/server/server.routes.test.ts
import request from 'supertest';

// Mock the seeder so tests don't hit the real DB
jest.mock('api-src/db/seeder', () => ({
  seedSandboxData: jest.fn(async (shopId: number) => {
    // emulate small async op
    return Promise.resolve({ seeded: true, shopId });
  }),
}));

// Import after mocks so server loads the mocked seeder
import app from 'api-src/server';

describe('Server routes (smoke tests)', () => {
  it('GET /health should return 200 and status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ status: 'ok' }));
  });

  it('GET /api/v1/kore/search without q should return 400', async () => {
    const res = await request(app).get('/api/v1/kore/search');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'Missing query parameter "q"');
  });

  it('POST /api/v1/dev/seed-sandbox/:shop_id with invalid shopId returns 400', async () => {
    const res = await request(app).post('/api/v1/dev/seed-sandbox/not-a-number');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('POST /api/v1/dev/seed-sandbox/:shop_id with valid shopId calls seeder and returns 200', async () => {
    const spy = jest.requireMock('api-src/db/seeder').seedSandboxData as jest.Mock;
    spy.mockClear();

    const res = await request(app).post('/api/v1/dev/seed-sandbox/1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message', expect.stringContaining('Sandbox data seeded'));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(1);
  });
});
