import { orderVelocityFulfillmentPlane } from
  'api-src/services/alignment-planes/planes/orderVelocityFulfillment.plane';

describe('Order Velocity ↔ Fulfillment Plane — Contract', () => {
  const baseInput = {
    orders: {
      velocity: null,
      visibility: 'sufficient' as const,
    },
    fulfillment: {
      operationalReality: null,
      visibility: 'sufficient' as const,
    },
  };

  test('fails closed when visibility is insufficient', () => {
    const result = orderVelocityFulfillmentPlane.compute({
      orders: { velocity: 'up', visibility: 'insufficient' },
      fulfillment: { operationalReality: 'real', visibility: 'sufficient' },
    });

    expect(result).toBe('unknown');
  });

  test('fails closed when velocity is unknown', () => {
    const result = orderVelocityFulfillmentPlane.compute({
      orders: { velocity: 'unknown', visibility: 'sufficient' },
      fulfillment: { operationalReality: 'real', visibility: 'sufficient' },
    });

    expect(result).toBe('unknown');
  });

  test('fails closed when fulfillment reality is unknown', () => {
    const result = orderVelocityFulfillmentPlane.compute({
      orders: { velocity: 'up', visibility: 'sufficient' },
      fulfillment: { operationalReality: 'unknown', visibility: 'sufficient' },
    });

    expect(result).toBe('unknown');
  });

  test('divergent when order velocity increases without fulfillment grounding', () => {
    const result = orderVelocityFulfillmentPlane.compute({
      orders: { velocity: 'up', visibility: 'sufficient' },
      fulfillment: { operationalReality: 'unreal', visibility: 'sufficient' },
    });

    expect(result).toBe('divergent');
  });

  test('divergent when flat velocity meets unreal fulfillment', () => {
    const result = orderVelocityFulfillmentPlane.compute({
      orders: { velocity: 'flat', visibility: 'sufficient' },
      fulfillment: { operationalReality: 'unreal', visibility: 'sufficient' },
    });

    expect(result).toBe('divergent');
  });

  test('aligned when velocity increases and fulfillment is real', () => {
    const result = orderVelocityFulfillmentPlane.compute({
      orders: { velocity: 'up', visibility: 'sufficient' },
      fulfillment: { operationalReality: 'real', visibility: 'sufficient' },
    });

    expect(result).toBe('aligned');
  });

  test('aligned when velocity decreases regardless of fulfillment reality', () => {
    const result = orderVelocityFulfillmentPlane.compute({
      orders: { velocity: 'down', visibility: 'sufficient' },
      fulfillment: { operationalReality: 'unreal', visibility: 'sufficient' },
    });

    expect(result).toBe('aligned');
  });

  test('unknown when required signals are missing', () => {
    const result = orderVelocityFulfillmentPlane.compute(baseInput);
    expect(result).toBe('unknown');
  });
});
