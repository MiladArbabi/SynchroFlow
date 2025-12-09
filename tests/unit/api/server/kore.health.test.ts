// apps/backend/tests/kore.health.test.ts
import request from 'supertest';

// Mock DB raw to avoid hitting real DB during tests
jest.mock('api-src/db', () => {
  // Provide a lightweight mock that has a `raw` method which resolves,
  // and a `__esModule` to satisfy default import semantics.
  return {
    __esModule: true,
    default: {
      raw: jest.fn(async (q?: any) => {
        if (q && typeof q === 'string' && q.includes('SELECT 11')) {
          return Promise.resolve([{ result: 11 }]);
        }
        return Promise.resolve();
      }),
    },
  };
});

// Import app after mocking db
import app from 'api-src/server';

describe('Kore health endpoint', () => {
  it('GET /api/v1/kore/health returns healthy when DB raw works', async () => {
    const res = await request(app).get('/api/v1/kore/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        status: 'healthy',
        services: expect.objectContaining({ database: 'connected' }),
      }),
    );
  });

  it('GET /api/v1/kore/health returns 503 when DB raw throws', async () => {
    const db = jest.requireMock('api-src/db').default as any;
    // make db.raw throw for this scenario
    (db.raw as jest.Mock).mockImplementationOnce(async () => { throw new Error('db down'); });

    const res = await request(app).get('/api/v1/kore/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual(
      expect.objectContaining({
        status: 'unhealthy',
        services: expect.objectContaining({ database: 'disconnected' }),
      }),
    );
  });
});
