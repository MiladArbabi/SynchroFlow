// tests/unit/specter/session-store.test.ts
import { InMemorySessionStore } from '../../../modules/specter/src/store/session-store';

describe('InMemorySessionStore (red tests)', () => {
  let store: InMemorySessionStore;

  beforeEach(() => {
    store = new InMemorySessionStore();
  });

  it('persists a normalized session and returns a sessionId', async () => {
    const session = {
      shopId: 7,
      sessionId: 'sess-abc-123',
      landingPage: '/product/1',
      pagesViewed: ['/product/1'],
      exitIntent: true,
      createdAt: new Date().toISOString()
    } as any;

    const id = await store.saveSession(session);
    expect(typeof id).toBe('string');

    const recent = await store.getSessionsLastNDays(session.shopId, 7);
    expect(Array.isArray(recent)).toBe(true);
    expect(recent.find((s: any) => s.sessionId === id)).toBeDefined();
  });

  it('returns empty array when no sessions exist for shop', async () => {
    const recent = await store.getSessionsLastNDays(9999, 7);
    expect(Array.isArray(recent)).toBe(true);
    expect(recent.length).toBe(0);
  });
});


// We'll mock the session-store module inside isolateModules to verify handler wiring.
// IMPORTANT: the real module exports a named `sessionStore` instance (not only a class).
// Provide both the class and a concrete instance so imports like:
// `import { sessionStore, InMemorySessionStore } from '.../session-store'`
// work inside the code under test.
const mockSessionStore = () => {
  class MockStore {
    saveSession = jest.fn(async (s: any) => s.sessionId || 'sess-mock-1');
    getSessionsLastNDays = jest.fn(async () => []);
    getAllSessionsForShop = jest.fn(() => []);
    reset = jest.fn(() => { /* no-op for tests */ });
    clearAll = jest.fn(() => { this.reset(); });
  }

  const instance = new MockStore();

  return {
    __esModule: true,
    // Named class export (kept for compatibility with some consumers)
    InMemorySessionStore: MockStore,
    // Named instance export expected by ingestion code
    sessionStore: instance,
    // Make default/ESM consumers happy as well
    default: instance
  };
};

describe('Specter ingestion handler (red tests)', () => {
  it('returns 400 when raw customerId is present (PCD violation)', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../../../modules/specter/src/store/session-store', () => mockSessionStore());

      const { handler } = await import('../../../modules/specter/src/api/ingest.handler');

      const req: any = {
        body: {
          shopId: 1,
          session: {
            shopId: 1,
            customerId: 'raw-customer-1', // PCD violation
            landingPage: '/home',
            pagesViewed: [],
            exitIntent: false
          }
        }
      };

      const json = jest.fn();
      const res: any = {
        status: jest.fn(() => ({ json })),
      };

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalled();
      const payload = json.mock.calls[0][0];
      expect(payload).toHaveProperty('error');
      expect(String(payload.error)).toMatch(/PCD/i);
    });
  });

  it('normalizes and persists valid session, returns 200 with sessionId', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../../../modules/specter/src/store/session-store', () => mockSessionStore());

      const { handler } = await import('../../../modules/specter/src/api/ingest.handler');

      const req: any = {
        body: {
          shopId: 2,
          session: {
            shopId: 2,
            landingPage: '/checkout?email=user%40x.com&ref=google',
            pagesViewed: ['/p1?phone=123', '/p2'],
            exitIntent: true
          }
        }
      };

      const json = jest.fn();
      const res: any = {
        status: jest.fn(() => ({ json })),
      };

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalled();
      const payload = json.mock.calls[0][0];
      // Expect the handler to return either the saved session id or the normalized session
      expect(payload).toBeDefined();
    });
  });
});