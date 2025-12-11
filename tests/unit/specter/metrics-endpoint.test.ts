// tests/unit/specter/metrics-endpoint.test.ts
// Unit test for Specter metrics controller using jest.mock + require()
// This avoids unstable_mockModule / ESM mock race conditions.

const shopIdStr = '42';
const shopIdNum = 42;

// Reset modules between tests to ensure clean require() state
beforeAll(() => {
  jest.resetModules();
});

// Provide a CJS-style mock for the modules-specter store helpers.
// The controller synchronously requires 'modules-specter/store/session-store',
// so this jest.mock() will be picked up by require() below.
jest.mock('modules-specter/store/session-store', () => {
  return {
    getShopSession: jest.fn(async (shopId: number) => {
      if (Number(shopId) === shopIdNum) {
        return {
          sessionId: 's-1',
          shopId: shopIdNum,
          createdAt: '2025-12-01T00:00:00Z',
          exitIntent: false
        };
      }
      return null;
    }),
    getRecentEvents: jest.fn(async (shopId: number, limit = 50) => {
      if (Number(shopId) === shopIdNum) {
        return [
          { type: 'sync.complete', timestamp: Date.now(), payload: { ok: true } },
          { type: 'canonical.ingested', timestamp: Date.now() - 1000, payload: { orderId: 'o1' } }
        ];
      }
      return [];
    }),
    getShopConfig: jest.fn(async (shopId: number) => {
      if (Number(shopId) === shopIdNum) {
        return { syncFrequency: 60, enabled: true };
      }
      return null;
    })
  };
});

let controllerModule: any;

beforeAll(() => {
  // Use require so the jest.mock above is applied synchronously.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  controllerModule = require('../../../apps/backend/src/api/specter/specter.controller');
});

describe('Specter metrics endpoint (unit) - CJS mock', () => {
  test('GET /api/v1/specter/:shopId/state returns expected shape and meta', async () => {
    const req: any = { params: { shopId: shopIdStr } };
    let statusCode = 200; // controller always returns 200 in success path
    let jsonBody: any = null;
    const res: any = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: any) {
        jsonBody = payload;
        return this;
      }
    };

    await controllerModule.getSpecterState(req, res);

    expect(statusCode).toBe(200);
    expect(jsonBody).not.toBeNull();
    expect(jsonBody).toMatchObject({
      shopId: 42,
      session: expect.any(Object),
      config: expect.any(Object),
      events: expect.any(Array),
      meta: expect.objectContaining({
        lastSync: expect.any(Number),
        lastIngestion: expect.any(Number),
        sessionCount: 1
      })
    });

    expect(jsonBody.session).toMatchObject({ sessionId: 's-1', shopId: 42 });
    expect(jsonBody.events[0].type).toBe('sync.complete');
    expect(jsonBody.config).toMatchObject({ syncFrequency: 60, enabled: true });
  });

  test('GET /api/v1/specter/:shopId/state handles missing shop gracefully', async () => {
    const req: any = { params: { shopId: '9999' } };
    let statusCode = 0;
    let jsonBody: any = null;
    const res: any = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: any) {
        jsonBody = payload;
        return this;
      }
    };

    await controllerModule.getSpecterState(req, res);

    // For missing shop, controller should still return 200 with null/empty parts
    expect(statusCode === 200 || statusCode === 0).toBeTruthy();
    expect(jsonBody).toHaveProperty('session', null);
    expect(Array.isArray(jsonBody.events)).toBe(true);
    expect(jsonBody.config === null || typeof jsonBody.config === 'object').toBeTruthy();
    expect(jsonBody.meta).toHaveProperty('lastSync');
    expect(jsonBody.meta).toHaveProperty('lastIngestion');
  });
});
