import { shippingFulfillmentCoherencePlane } from
  'api-src/services/alignment-planes/planes/shippingFulfillmentCoherence.plane';

describe('Shipping ↔ Fulfillment Coherence Plane — Contract', () => {
  const baseInput = {
    fulfillment: {
      operationalReality: null,
      visibility: 'sufficient' as const,
    },
    shipping: {
      signal: null,
      visibility: 'sufficient' as const,
    },
  };

  test('fails closed when fulfillment reality is unknown', () => {
    const result = shippingFulfillmentCoherencePlane.compute({
      fulfillment: {
        operationalReality: 'unknown',
        visibility: 'sufficient',
      },
      shipping: {
        signal: 'present',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('unknown');
  });

  test('fails closed when shipping signal is missing', () => {
    const result = shippingFulfillmentCoherencePlane.compute({
      fulfillment: {
        operationalReality: 'real',
        visibility: 'sufficient',
      },
      shipping: {
        signal: null,
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('unknown');
  });

  test('divergent when fulfillment is real but shipping is absent', () => {
    const result = shippingFulfillmentCoherencePlane.compute({
      fulfillment: {
        operationalReality: 'real',
        visibility: 'sufficient',
      },
      shipping: {
        signal: 'absent',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('divergent');
  });

  test('divergent when fulfillment is unreal but shipping is present', () => {
    const result = shippingFulfillmentCoherencePlane.compute({
      fulfillment: {
        operationalReality: 'unreal',
        visibility: 'sufficient',
      },
      shipping: {
        signal: 'present',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('divergent');
  });

  test('aligned when fulfillment is real and shipping is present', () => {
    const result = shippingFulfillmentCoherencePlane.compute({
      fulfillment: {
        operationalReality: 'real',
        visibility: 'sufficient',
      },
      shipping: {
        signal: 'present',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('aligned');
  });

  test('aligned when fulfillment is unreal and shipping is absent', () => {
    const result = shippingFulfillmentCoherencePlane.compute({
      fulfillment: {
        operationalReality: 'unreal',
        visibility: 'sufficient',
      },
      shipping: {
        signal: 'absent',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('aligned');
  });

  test('unknown when required signals are missing', () => {
    const result = shippingFulfillmentCoherencePlane.compute(baseInput);
    expect(result).toBe('unknown');
  });
});