// tests/unit/backend/ft2/analytics.ft2.controller.presetAuthority.test.ts

import request from 'supertest';
import express from 'express';

// ─────────────────────────────────────────────
// Global spies (Jest-safe, no closure leaks)
// ─────────────────────────────────────────────
beforeEach(() => {
  (globalThis as any).__resolvePresetSpy = jest.fn(() => ({
    from: 'RESOLVED_FROM',
    to: 'RESOLVED_TO',
  }));

  (globalThis as any).__getFt2PeriodSpy = jest.fn(() => ({
    from: 'FALLBACK_FROM',
    to: 'FALLBACK_TO',
  }));

  (globalThis as any).__snapshotSpy = jest.fn(async () => ({
    context: {
      period: { from: 'RESOLVED_FROM', to: 'RESOLVED_TO' },
    },
  }));
});

afterEach(() => {
  delete (globalThis as any).__resolvePresetSpy;
  delete (globalThis as any).__getFt2PeriodSpy;
  delete (globalThis as any).__snapshotSpy;
});

// ─────────────────────────────────────────────
// Mocks (must NOT capture out-of-scope vars)
// ─────────────────────────────────────────────
jest.mock('api-src/utils/ft2Period', () => ({
  resolveFt2PeriodFromPreset: (input: any) =>
    (globalThis as any).__resolvePresetSpy(input),
  getFt2Period: () =>
    (globalThis as any).__getFt2PeriodSpy(),
}));

jest.mock(
  'api-src/services/analytics-ft2.provider',
  () => ({
    getAnalyticsFt2Snapshot: (input: any) =>
      (globalThis as any).__snapshotSpy(input),
  })
);

jest.mock('api-src/middleware/auth.middleware', () => ({
  authenticateToken: (
    req: any,
    _res: any,
    next: any
  ) => {
    req.user = { shopId: 999 };
    next();
  },
}));

jest.mock('api-src/middleware/require-ft2.middleware', () => ({
  requireFt2: (_req: any, _res: any, next: any) =>
    next(),
}));

// ─────────────────────────────────────────────
// Import router AFTER mocks
// ─────────────────────────────────────────────
import analyticsFt2Router from
  'api-src/api/analytics/analytics.routes';

// ─────────────────────────────────────────────
// Test
// ─────────────────────────────────────────────
describe(
  'Analytics FT2 Controller — preset authority (RED)',
  () => {
    it(
      'uses preset to resolve period and does NOT fall back to getFt2Period()',
      async () => {
        const app = express();
        app.use(express.json());
        app.use(
          '/api/v1/modules/analytics',
          analyticsFt2Router as unknown as express.Router
        );

        await request(app)
          .get(
            '/api/v1/modules/analytics/ft2?preset=past_7_days'
          )
          .expect(200);

        // ───────────────────────────────────
        // Authority assertions (MUST FAIL now)
        // ───────────────────────────────────

        expect(
          (globalThis as any).__resolvePresetSpy
        ).toHaveBeenCalledTimes(1);

        expect(
          (globalThis as any).__resolvePresetSpy
        ).toHaveBeenCalledWith({
          preset: 'past_7_days',
        });

        expect(
          (globalThis as any).__getFt2PeriodSpy
        ).not.toHaveBeenCalled();

        expect(
          (globalThis as any).__snapshotSpy
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            shopId: 999,
            period: {
              from: 'RESOLVED_FROM',
              to: 'RESOLVED_TO',
            },
          })
        );
      }
    );
  }
);