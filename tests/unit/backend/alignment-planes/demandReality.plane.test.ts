import { demandRealityPlane } from 'api-src/services/alignment-planes/demandReality.plane';

describe('Demand Reality Plane — Contract', () => {
  const baseInput = {
    customers: {
      engagementTrend: null,
      visibility: 'sufficient' as const,
    },
    orders: {
      trend: null,
      outcome: null,
      visibility: 'sufficient' as const,
    },
  };

  test('fails closed when visibility is insufficient', () => {
    const result = demandRealityPlane.compute({
      ...baseInput,
      customers: { engagementTrend: 'up', visibility: 'insufficient' },
    });

    expect(result).toBe('unknown');
  });

  test('aligned when engagement ↑ and orders ↑ with positive outcome', () => {
    const result = demandRealityPlane.compute({
      customers: { engagementTrend: 'up', visibility: 'sufficient' },
      orders: {
        trend: 'up',
        outcome: 'positive',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('aligned');
  });

  test('divergent when engagement ↑ but orders flat', () => {
    const result = demandRealityPlane.compute({
      customers: { engagementTrend: 'up', visibility: 'sufficient' },
      orders: {
        trend: 'flat',
        outcome: 'positive',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('divergent');
  });

  test('divergent when engagement ↓ but orders ↑', () => {
    const result = demandRealityPlane.compute({
      customers: { engagementTrend: 'down', visibility: 'sufficient' },
      orders: {
        trend: 'up',
        outcome: 'positive',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('divergent');
  });

  test('divergent when outcome is negative regardless of trend', () => {
    const result = demandRealityPlane.compute({
      customers: { engagementTrend: 'up', visibility: 'sufficient' },
      orders: {
        trend: 'up',
        outcome: 'negative',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('divergent');
  });

  test('unknown when any required signal is missing', () => {
    const result = demandRealityPlane.compute(baseInput);
    expect(result).toBe('unknown');
  });
});