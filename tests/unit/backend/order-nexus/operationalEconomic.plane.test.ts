import { operationalEconomicPlane } from
  'api-src/services/alignment-planes/planes/operationalEconomic.plane';

describe('Operational ↔ Economic Alignment Plane', () => {
  it('returns unknown when visibility is insufficient', () => {
    const result = operationalEconomicPlane.compute({
      orders: {
        outcome: 'positive',
        visibility: 'insufficient',
      },
      fulfillment: {
        operationalReality: 'real',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('unknown');
  });

  it('returns aligned when positive outcome is operationally real', () => {
    const result = operationalEconomicPlane.compute({
      orders: {
        outcome: 'positive',
        visibility: 'sufficient',
      },
      fulfillment: {
        operationalReality: 'real',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('aligned');
  });

  it('returns aligned when negative outcome is operationally unreal', () => {
    const result = operationalEconomicPlane.compute({
      orders: {
        outcome: 'negative',
        visibility: 'sufficient',
      },
      fulfillment: {
        operationalReality: 'unreal',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('aligned');
  });

  it('returns divergent when signals contradict', () => {
    const result = operationalEconomicPlane.compute({
      orders: {
        outcome: 'positive',
        visibility: 'sufficient',
      },
      fulfillment: {
        operationalReality: 'unreal',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('divergent');
  });

  it('returns unknown when fulfillment reality is unknown', () => {
    const result = operationalEconomicPlane.compute({
      orders: {
        outcome: 'positive',
        visibility: 'sufficient',
      },
      fulfillment: {
        operationalReality: 'unknown',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('unknown');
  });
});