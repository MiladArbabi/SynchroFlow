import { salesOperationsPlane } from
  'api-src/services/alignment-planes/planes/salesOperations.plane';

describe('Sales ↔ Operations Alignment Plane — Contract', () => {
  const baseInput = {
    orders: {
      velocity: null,
      visibility: 'sufficient' as const,
    },
    fulfillment: {
      status: null,
      visibility: 'sufficient' as const,
    },
  };

  test('fails closed when order visibility is insufficient', () => {
    const result = salesOperationsPlane.compute({
      orders: {
        velocity: 'up',
        visibility: 'insufficient',
      },
      fulfillment: {
        status: 'fulfilled',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('unknown');
  });

  test('fails closed when fulfillment visibility is insufficient', () => {
    const result = salesOperationsPlane.compute({
      orders: {
        velocity: 'up',
        visibility: 'sufficient',
      },
      fulfillment: {
        status: 'fulfilled',
        visibility: 'insufficient',
      },
    });

    expect(result).toBe('unknown');
  });

  test('fails closed when order velocity is unknown', () => {
    const result = salesOperationsPlane.compute({
      orders: {
        velocity: 'unknown',
        visibility: 'sufficient',
      },
      fulfillment: {
        status: 'fulfilled',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('unknown');
  });

  test('divergent when orders increase but fulfillment is not fulfilled', () => {
    const result = salesOperationsPlane.compute({
      orders: {
        velocity: 'up',
        visibility: 'sufficient',
      },
      fulfillment: {
        status: 'partial',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('divergent');
  });

  test('aligned when orders increase and fulfillment is fulfilled', () => {
    const result = salesOperationsPlane.compute({
      orders: {
        velocity: 'up',
        visibility: 'sufficient',
      },
      fulfillment: {
        status: 'fulfilled',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('aligned');
  });

  test('aligned when orders are flat regardless of fulfillment status', () => {
    const result = salesOperationsPlane.compute({
      orders: {
        velocity: 'flat',
        visibility: 'sufficient',
      },
      fulfillment: {
        status: 'unfulfilled',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('aligned');
  });

  test('aligned when orders decrease regardless of fulfillment status', () => {
    const result = salesOperationsPlane.compute({
      orders: {
        velocity: 'down',
        visibility: 'sufficient',
      },
      fulfillment: {
        status: 'unfulfilled',
        visibility: 'sufficient',
      },
    });

    expect(result).toBe('aligned');
  });

  test('unknown when required signals are missing', () => {
    const result = salesOperationsPlane.compute(baseInput);
    expect(result).toBe('unknown');
  });
});
