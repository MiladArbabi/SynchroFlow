import { buildAnalyticsFtep } from 'api-src/services/analytics-ftep';

describe('Analytics FTEP (Layer 3)', () => {
  test('suppresses domain entirely when presence is unknown', () => {
    const exposure = buildAnalyticsFtep({
      intelligence: {
        snapshot: { id: 's1', extractedAt: 'now' },
        domains: {
          orders: {
            presence: 'unknown',
            raw: { observationCount: null, nullSurface: 1 },
            timestamps: { firstSeenAt: null, lastSeenAt: null },
          },
          products: null,
          customers: null,
          finances: null,
        },
      },
    } as any);

    expect(exposure.domains.orders).toBeNull();
  });

  test('exposes raw observability without intelligence leakage', () => {
    const exposure = buildAnalyticsFtep({
      intelligence: {
        snapshot: { id: 's1', extractedAt: 'now' },
        domains: {
          orders: {
            presence: 'present',
            raw: { observationCount: 3, nullSurface: 0 },
            timestamps: {
              firstSeenAt: 'a',
              lastSeenAt: 'b',
            },
          },
          products: null,
          customers: null,
          finances: null,
        },
      },
    } as any);

    expect(exposure.domains.orders).toEqual(
      expect.objectContaining({
        presence: true,
        observationCount: 3,
      })
    );
    expect((exposure as any).outcome).toBeUndefined();
  });
});