//tests/unit/backend/specter/specter-ft2.controller.test.ts
import request from 'supertest';
import app from 'api-server';
import { InMemorySessionStore, setSessionStoreForTests } from 'modules-specter/store/session-store';

describe('GET /api/v1/specter/ft2', () => {
  const shopId = 99;

  beforeEach(() => {
    const store = new InMemorySessionStore([
      {
        sessionId: 's1',
        shopId,
        exitIntent: false,
        pagesViewed: ['/'],
        createdAt: new Date().toISOString()
      }
    ]);
    setSessionStoreForTests(store);
  });

  afterEach(() => {
    setSessionStoreForTests(null);
  });

  it('returns FT2 specter snapshot', async () => {
    const res = await request(app)
      .get('/api/v1/specter/ft2')
      .set('x-test-shop-id', String(shopId)) // matches existing test infra
      .expect(200);

    expect(res.body.context.sessionsObserved).toBe(1);
    expect(res.body.outcome).toBeDefined();
  });

  it('does not leak intelligence', async () => {
    const res = await request(app)
      .get('/api/v1/specter/ft2')
      .set('x-test-shop-id', String(shopId))
      .expect(200);

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/engagement|behavior|exitIntent|risk/i);
  });
});