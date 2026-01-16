// tests/unit/backend/ft2/products.ft2.controller.presetAuthority.test.ts

import request from 'supertest';
import express from 'express';

// ─────────────────────────────────────────────
// Auth + FT2 middleware mocks
// ─────────────────────────────────────────────
jest.mock('api-src/middleware/auth.middleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = { shopId: 123 };
    next();
  },
}));

jest.mock('api-src/middleware/require-ft2.middleware', () => ({
  requireFt2: (_req: any, _res: any, next: any) => next(),
}));

// ─────────────────────────────────────────────
// Period resolver mock (authority boundary)
// ─────────────────────────────────────────────
jest.mock('api-src/utils/ft2Period', () => {
  return {
    resolveFt2PeriodFromPreset: jest.fn(),
    getFt2Period: jest.fn(),
  };
});

// ─────────────────────────────────────────────
// FT2 provider mock (not under test)
// ─────────────────────────────────────────────
jest.mock('api-src/services/products-ft2.provider', () => ({
  getProductsFt2Snapshot: jest.fn(async ({ period }: any) => ({
    context: {
      period,
      productsObserved: 5,
    },
    outcome: { status: 'positive' },
    trend: { direction: 'up' },
    signals: {
      catalog: 'ok',
      skuCoverage: 'ok',
      variantComplexity: 'simple',
    },
  })),
}));

// ─────────────────────────────────────────────
// Imports AFTER mocks
// ─────────────────────────────────────────────
import productsFt2Router from 'api-src/api/products/products.ft2.routes';
import {
  resolveFt2PeriodFromPreset,
  getFt2Period,
} from 'api-src/utils/ft2Period';

// ─────────────────────────────────────────────
// Test app builder
// ─────────────────────────────────────────────
function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/modules/products', productsFt2Router);
  return app;
}

// ─────────────────────────────────────────────
// Test
// ─────────────────────────────────────────────
describe('Products FT2 Controller — preset authority (RED)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses preset to resolve period and does NOT fall back to getFt2Period()', async () => {
    (resolveFt2PeriodFromPreset as jest.Mock).mockReturnValue({
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-07T23:59:59.999Z',
    });

    const app = buildTestApp();

    const res = await request(app)
      .get('/api/v1/modules/products/ft2')
      .query({ preset: 'past_7_days' })
      .expect(200);

    // Authority assertions
    expect(resolveFt2PeriodFromPreset).toHaveBeenCalledTimes(1);
    expect(resolveFt2PeriodFromPreset).toHaveBeenCalledWith({
      preset: 'past_7_days',
    });

    // ❌ Must fail until controller is fixed
    expect(getFt2Period).not.toHaveBeenCalled();

    // Response uses resolved period
    expect(res.body.context.period).toEqual({
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-07T23:59:59.999Z',
    });
  });
});
