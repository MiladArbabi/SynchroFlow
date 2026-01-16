// tests/unit/backend/ft2/customers.ft2.controller.presetAuthority.test.ts

import request from 'supertest';
import express from 'express';

// ─────────────────────────────────────────────
// Global spies (Jest-safe)
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
// Mocks (NO out-of-scope references)
// ─────────────────────────────────────────────
jest.mock('api-src/utils/ft2Period', () => ({
  resolveFt2PeriodFromPreset: (input: any) =>
    (globalThis as any).__resolvePresetSpy(input),
  getFt2Period: () =>
    (globalThis as any).__getFt2PeriodSpy(),
}));

jest.mock(
  'api-src/services/customers-ft2.provider',
  () => ({
    getCustomersFt2Snapshot: (input: any) =>
      (globalThis as any).__snapshotSpy(input),
  })
);

jest.mock('api-src/middleware/auth.middleware', () => ({
  authenticateToken: (
    req: any,
    _res: any,
    next: any
  ) => {
    req.user = { shopId: 123 };
    next();
  },
}));

jest.mock('api-src/middleware/require-ft2.middleware', () => ({
  requireFt2: (_req: any, _res: any, next: any) =>
    next(),
}));

// ─────────────────────────────────────────────
// Import AFTER mocks
// ─────────────────────────────────────────────
import customersFt2Router from
  'api-src/api/customers/customers.ft2.routes';

// ─────────────────────────────────────────────
// Test
// ─────────────────────────────────────────────
describe(
  'Customers FT2 Controller — preset authority (RED)',
  () => {
    it(
      'uses preset to resolve period and does NOT compute dates inline',
      async () => {
        const app = express();
        app.use(express.json());
        app.use(
          '/api/v1/modules/customers',
          customersFt2Router as unknown as express.Router
        );

        await request(app)
          .get(
            '/api/v1/modules/customers/ft2?preset=past_7_days'
          )
          .expect(200);

        // ── Authority assertions ──

        // ❌ MUST FAIL until controller is fixed
        expect(
          (globalThis as any).__resolvePresetSpy
        ).toHaveBeenCalledTimes(1);

        expect(
          (globalThis as any).__resolvePresetSpy
        ).toHaveBeenCalledWith({
          preset: 'past_7_days',
        });

        // ❌ MUST NOT fall back
        expect(
          (globalThis as any).__getFt2PeriodSpy
        ).not.toHaveBeenCalled();

        // ❌ Snapshot must receive resolved period
        expect(
          (globalThis as any).__snapshotSpy
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            shopId: 123,
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