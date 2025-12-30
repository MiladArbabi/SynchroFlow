// tests/integration/specter-route.integration.test.ts
/**
 * Lightweight integration test for Specter routes using supertest.
 * - Uses in-memory Specter store by setting SPECTER_SESSION_STORE=memory
 * - Pre-populates the in-memory store with a session  events so meta fields are populated
 */

jest.setTimeout(10000);
jest.resetModules();

// ensure in-memory store is chosen
process.env.SPECTER_SESSION_STORE = 'memory';
process.env.NODE_ENV = 'test';

import request from 'supertest';

// Import the express app (server.ts exports default app)
const app = require('api-src/server').default;

describe('Specter routes (integration)', () => {
  let token: string;

  beforeAll(async () => {
    // Get dev token from the app (no external auth dependency)
    const res = await request(app).get('/api/v1/auth/dev-token');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    token = res.body.token;

    // Pre-populate the in-memory specter store so meta/session expectations are deterministic
    try {
      // Resolve runtime store helpers (CJS require works in jest)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const storeMod: any = require('modules-specter/store/session-store');
      const sessionStore = storeMod.sessionStore ?? storeMod.default ?? null;

      // If we have a programmatic API, use it; otherwise no-op
      if (sessionStore) {
        // reset any prior state
        if (typeof sessionStore.reset === 'function') sessionStore.reset();

        // create a session visible to getShopSession
        if (typeof sessionStore.saveSession === 'function') {
          await sessionStore.saveSession({
            sessionId: 's-1',
            shopId: 42,
            createdAt: new Date().toISOString(),
            exitIntent: false,
            pagesViewed: []
          });
        }

        // append events (newest-first)
        if (typeof sessionStore.appendEvent === 'function') {
          // append older event first, then newer event so events[0] === newest ('sync.complete')
          await sessionStore.appendEvent(42, { type: 'canonical.ingested', timestamp: Date.now() - 1000, payload: { orderId: 'o1' } });
          await sessionStore.appendEvent(42, { type: 'sync.complete', timestamp: Date.now(), payload: { ok: true } });
        }
      }
    } catch (e: any) {
      // Non-fatal: allow test to continue if we can't pre-seed
      // eslint-disable-next-line no-console
      console.warn('[test setup] failed to pre-populate specter store:', e && e.message ? e.message : e);
    }
  });

  test('GET /api/v1/specter/42/state returns expected JSON shape', async () => {
    const res = await request(app)
      .get('/api/v1/specter/42/state')
      .set('Authorization', `Bearer ${token}`)
      .expect('Content-Type', /json/)
      .expect(200);

    expect(res.body).toMatchObject({
      shopId: 42,
      session: expect.any(Object),
      config: null,
      events: expect.any(Array),
      meta: expect.objectContaining({
        sessionCount: 1,
        lastSync: expect.any(Number),
        lastIngestion: expect.any(Number)
      })
    });
    // extra sanity checks
    expect(res.body.session).toMatchObject({ sessionId: 's-1', shopId: 42 });
    expect(res.body.events[0].type).toBe('sync.complete');
  });

  test.skip('GET /api/v1/specter/state (auth-derived) returns same shape', async () => {
    const res = await request(app)
      .get('/api/v1/specter/state')
      .set('Authorization', `Bearer ${token}`)
      .expect('Content-Type', /json/)
      .expect(200);

    expect(res.body).toHaveProperty('shopId');
    expect(res.body.events).toBeInstanceOf(Array);
  });
});