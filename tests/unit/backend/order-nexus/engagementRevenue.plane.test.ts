import { engagementRevenuePlane } from
  'api-src/services/alignment-planes/planes/engagementRevenue.plane';

describe('Engagement ↔ Revenue Alignment Plane', () => {
  it('returns unknown when visibility is insufficient', () => {
    const result = engagementRevenuePlane.compute({
      customers: {
        engagementTrend: 'up',
        visibility: 'insufficient',
      },
      orders: {
        outcome: 'positive',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('unknown');
  });

  it('returns aligned when engagement up matches positive outcome', () => {
    const result = engagementRevenuePlane.compute({
      customers: {
        engagementTrend: 'up',
        visibility: 'sufficient',
      },
      orders: {
        outcome: 'positive',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('aligned');
  });

  it('returns aligned when engagement down matches negative outcome', () => {
    const result = engagementRevenuePlane.compute({
      customers: {
        engagementTrend: 'down',
        visibility: 'sufficient',
      },
      orders: {
        outcome: 'negative',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('aligned');
  });

  it('returns divergent on mismatch', () => {
    const result = engagementRevenuePlane.compute({
      customers: {
        engagementTrend: 'up',
        visibility: 'sufficient',
      },
      orders: {
        outcome: 'negative',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('divergent');
  });

  it('returns unknown for flat engagement', () => {
    const result = engagementRevenuePlane.compute({
      customers: {
        engagementTrend: 'flat',
        visibility: 'sufficient',
      },
      orders: {
        outcome: 'positive',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('unknown');
  });
});