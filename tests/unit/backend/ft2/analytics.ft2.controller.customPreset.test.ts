// tests/unit/backend/ft2/analytics.ft2.controller.customPreset.test.ts
import request from 'supertest';
import express from 'express';

import analyticsRouter from 'api-src/api/analytics/analytics.routes';

// ─────────────────────────────────────────────
// Global spies (Jest-safe)
// ─────────────────────────────────────────────

beforeEach(() => {
  (globalThis as any).__resolvePresetSpy = jest.fn(() => ({
    from: 'CUSTOM_FROM',
    to: 'CUSTOM_TO',
  }));

  (globalThis as any).__getFt2PeriodSpy = jest.fn();
});

afterEach(() => {
  delete (globalThis as any).__resolvePresetSpy;
  delete (globalThis as any).__getFt2PeriodSpy;
});

// ─────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────

jest.mock('api-src/utils/ft2Period', () => ({
  resolveFt2PeriodFromPreset: (input: any) =>
    (globalThis as any).__resolvePresetSpy(input),
  getFt2Period: () =>
    (globalThis as any).__getFt2PeriodSpy(),
}));

jest.mock('api-src/services/analytics-ft2.provider', () => ({
  getAnalyticsFt2Snapshot: jest.fn(async () => ({
    context: {
      period: {
        from: 'CUSTOM_FROM',
        to: 'CUSTOM_TO',
      },
    },
    outcome: { status: 'positive' },
    trend: { direction: 'unknown' },
  })),
}));

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
// Test
// ─────────────────────────────────────────────

describe('Analytics FT2 Controller — custom preset authority', () => {
  it('uses custom preset to resolve period and does NOT fall back to getFt2Period()', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/modules/analytics', analyticsRouter as any);

    await request(app)
      .get('/api/v1/modules/analytics/ft2')
      .query({
        preset: 'custom',
        from: '2024-01-01T00:00:00.000Z',
        to: '2024-01-31T23:59:59.999Z',
      })
      .expect(200);

    // ── Authority assertions ──
    expect(
      (globalThis as any).__resolvePresetSpy
    ).toHaveBeenCalledTimes(1);

    expect(
      (globalThis as any).__resolvePresetSpy
    ).toHaveBeenCalledWith({
      preset: 'custom',
      from: '2024-01-01T00:00:00.000Z',
      to: '2024-01-31T23:59:59.999Z',
    });

    expect(
      (globalThis as any).__getFt2PeriodSpy
    ).not.toHaveBeenCalled();
  });
});