import { getOrderNexusFt2Distribution } from 'api-src/services/order-nexus-ft2/orderNexusFt2.distribution';

describe('Orders FT2 — Distribution Facts', () => {
  it('computes min = median = max for single order', async () => {
    const result = await getOrderNexusFt2Distribution({
      shopId: 1,
      range: {
        preset: 'custom',
        from: '2026-01-01',
        to: '2026-01-31',
      },
    });

    expect(result.minOrderValue).toBe(result.medianOrderValue);
    expect(result.maxOrderValue).toBe(result.medianOrderValue);
  });

  it('histogram counts sum to total orders', async () => {
    const result = await getOrderNexusFt2Distribution({
      shopId: 1,
      range: {
        preset: 'custom',
        from: '2026-01-01',
        to: '2026-01-31',
      },
    });

    const total = result.histogram.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(result.totalOrders);
  });

  it('does not expose quality labels or benchmarks', async () => {
    const result = await getOrderNexusFt2Distribution({
      shopId: 1,
      range: {
        preset: 'custom',
        from: '2026-01-01',
        to: '2026-01-31',
      },
    });

    expect(result).not.toHaveProperty('quality');
    expect(result).not.toHaveProperty('benchmark');
  });
});