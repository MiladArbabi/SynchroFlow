import { ordersShippingCarrierPlane } from
  'api-src/services/alignment-planes/planes/ordersShippingCarrier.plane';

describe('Orders ↔ Shipping Carrier Alignment Plane — Contract', () => {
  const baseInput = {
    orders: {
      fulfillmentStatus: null,
      visibility: 'sufficient' as const,
    },
    shipping: {
      signal: null,
      visibility: 'sufficient' as const,
    },
  };

  test('fails closed when order visibility is insufficient', () => {
    const result = ordersShippingCarrierPlane.compute({
      orders: {
        fulfillmentStatus: 'fulfilled',
        visibility: 'insufficient',
      },
      shipping: {
        signal: 'present',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('unknown');
  });

  test('fails closed when shipping visibility is insufficient', () => {
    const result = ordersShippingCarrierPlane.compute({
      orders: {
        fulfillmentStatus: 'fulfilled',
        visibility: 'sufficient',
      },
      shipping: {
        signal: 'present',
        visibility: 'insufficient',
      },
    });

    expect(result).toBe('unknown');
  });

  test('fails closed when required signals are missing', () => {
    const result = ordersShippingCarrierPlane.compute(baseInput);
    expect(result).toBe('unknown');
  });

  test('divergent when orders are fulfilled but no shipping exists', () => {
    const result = ordersShippingCarrierPlane.compute({
      orders: {
        fulfillmentStatus: 'fulfilled',
        visibility: 'sufficient',
      },
      shipping: {
        signal: 'absent',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('divergent');
  });

  test('divergent when shipping exists but orders are unfulfilled', () => {
    const result = ordersShippingCarrierPlane.compute({
      orders: {
        fulfillmentStatus: 'unfulfilled',
        visibility: 'sufficient',
      },
      shipping: {
        signal: 'present',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('divergent');
  });

  test('aligned when orders are fulfilled and shipping exists', () => {
    const result = ordersShippingCarrierPlane.compute({
      orders: {
        fulfillmentStatus: 'fulfilled',
        visibility: 'sufficient',
      },
      shipping: {
        signal: 'present',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('aligned');
  });

  test('aligned when orders are unfulfilled and no shipping exists', () => {
    const result = ordersShippingCarrierPlane.compute({
      orders: {
        fulfillmentStatus: 'unfulfilled',
        visibility: 'sufficient',
      },
      shipping: {
        signal: 'absent',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('aligned');
  });
});