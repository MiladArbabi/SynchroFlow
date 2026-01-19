import { buildAnalyticsFtep } from 'api-src/services/analytics-ftep/analyticsFtep.service';

describe('Analytics FTEP (Layer 3)', () => {
  const baseIntelligence = {
    snapshot: {
      id: 's1',
      extractedAt: 'now',
    },
    domains: {
      orders: {
        presence: 'present',
        observationLevel: 'partial',
        continuity: 'continuous',
        timestamps: {
          firstSeenAt: 'a',
          lastSeenAt: 'b',
        },
        raw: {
          observationCount: 5,
          nullSurface: 0,
        },
      },
      products: null,
      customers: null,
      finances: null,
    },
  };

  test('exposes raw observability only', () => {
    const exposure = buildAnalyticsFtep({
      intelligence: baseIntelligence as any,
    });

    expect(exposure.snapshot.id).toBe('s1');
    expect(exposure.domains.orders).toEqual({
      presence: true,
      observationCount: 5,
      nullSurface: 0,
      firstSeenAt: 'a',
      lastSeenAt: 'b',
    });
  });

  test('suppresses domain when presence is unknown', () => {
    const exposure = buildAnalyticsFtep({
      intelligence: {
        ...baseIntelligence,
        domains: {
          ...baseIntelligence.domains,
          orders: {
            ...baseIntelligence.domains.orders,
            presence: 'unknown',
          },
        },
      } as any,
    });

    expect(exposure.domains.orders).toBeNull();
  });

  test('does not leak forbidden semantics', () => {
    const exposure = buildAnalyticsFtep({
      intelligence: baseIntelligence as any,
    });

    const serialized = JSON.stringify(exposure);
    expect(serialized).not.toMatch(
      /outcome|trend|margin|percentage|profit|loss|because|reason/i
    );
  });
});
