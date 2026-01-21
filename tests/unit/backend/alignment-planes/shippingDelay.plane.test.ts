import { shippingDelayFulfillmentCoherencePlane } from
  'api-src/services/alignment-planes/planes/shippingDelayFulfillmentCoherence.plane';

import { shippingDelayCustomerPromisePlane } from
  'api-src/services/alignment-planes/planes/shippingDelayCustomerPromise.plane';

describe('Shipping Delay ↔ Fulfillment Coherence Plane — Contract', () => {
  test('fails closed when inputs are epistemically insufficient', () => {
    const result = shippingDelayFulfillmentCoherencePlane.compute({
      fulfillment: {
        operationalReality: null,
        visibility: 'sufficient',
      },
      shippingDelay: {
        signal: null,
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('unknown');
  });

  test('aligned when fulfillment is real and delay exists', () => {
    const result = shippingDelayFulfillmentCoherencePlane.compute({
      fulfillment: {
        operationalReality: 'real',
        visibility: 'sufficient',
      },
      shippingDelay: {
        signal: 'present',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('aligned');
  });

  test('aligned when fulfillment is real and no delay exists', () => {
    const result = shippingDelayFulfillmentCoherencePlane.compute({
      fulfillment: {
        operationalReality: 'real',
        visibility: 'sufficient',
      },
      shippingDelay: {
        signal: 'absent',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('aligned');
  });

  test('aligned when fulfillment is unreal and no delay exists', () => {
    const result = shippingDelayFulfillmentCoherencePlane.compute({
      fulfillment: {
        operationalReality: 'unreal',
        visibility: 'sufficient',
      },
      shippingDelay: {
        signal: 'absent',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('aligned');
  });

  test('divergent when fulfillment is unreal but delay exists', () => {
    const result = shippingDelayFulfillmentCoherencePlane.compute({
      fulfillment: {
        operationalReality: 'unreal',
        visibility: 'sufficient',
      },
      shippingDelay: {
        signal: 'present',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('divergent');
  });
});

describe('Shipping Delay ↔ Customer Promise Plane — Contract', () => {
  test('fails closed when customer promise is not observable', () => {
    const result = shippingDelayCustomerPromisePlane.compute({
      shippingDelay: {
        signal: 'present',
        visibility: 'sufficient',
      },
      customerPromise: {
        signal: null,
        visibility: null,
      },
    });

    expect(result).toBe('unknown');
  });

  test('divergent when delay exists and promise exists', () => {
    const result = shippingDelayCustomerPromisePlane.compute({
      shippingDelay: {
        signal: 'present',
        visibility: 'sufficient',
      },
      customerPromise: {
        signal: 'present',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('divergent');
  });

  test('aligned when no delay exists and promise exists', () => {
    const result = shippingDelayCustomerPromisePlane.compute({
      shippingDelay: {
        signal: 'absent',
        visibility: 'sufficient',
      },
      customerPromise: {
        signal: 'present',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('aligned');
  });

  test('aligned when delay exists but no promise exists', () => {
    const result = shippingDelayCustomerPromisePlane.compute({
      shippingDelay: {
        signal: 'present',
        visibility: 'sufficient',
      },
      customerPromise: {
        signal: 'absent',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('aligned');
  });

  test('aligned when neither delay nor promise exists', () => {
    const result = shippingDelayCustomerPromisePlane.compute({
      shippingDelay: {
        signal: 'absent',
        visibility: 'sufficient',
      },
      customerPromise: {
        signal: 'absent',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('aligned');
  });
});
