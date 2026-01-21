import { getOrderNexusFt2Timeseries } from 'api-src/services/order-nexus-ft2/orderNexusFt2.timeseries';
import { seedCanonicalOrder } from '../../helpers/seedCanonicalOrder';

describe('Orders FT2 — Timeseries Facts', () => {
  it('returns zero-filled series when no orders exist in range but data exists', async () => {
    const result = await getOrderNexusFt2Timeseries({
      shopId: 1,
      range: {
        preset: 'custom',
        from: '2026-01-01',
        to: '2026-01-07',
      },
    });

    expect(result.series.length).toBeGreaterThan(0);
    expect(
      result.series.every(
        d => d.ordersObserved === 0 && d.revenueTotal === 0
      )
    ).toBe(true);
  });

  it('returns explicit zero for days with no orders', async () => {
    await seedCanonicalOrder({
      shopId: 1,
      createdAt: '2026-01-01T10:00:00Z'
    });

    const result = await getOrderNexusFt2Timeseries({
      shopId: 1,
      range: {
        preset: 'custom',
        from: '2026-01-01',
        to: '2026-01-07',
      },
    });

    expect(result.series[0]).toMatchObject({
      ordersObserved: 0,
      revenueTotal: 0
    });
  });

  it('does not expose trends, deltas, or classifications', async () => {
    const result = await getOrderNexusFt2Timeseries({
      shopId: 1,
      range: {
        preset: 'custom',
        from: '2026-01-01',
        to: '2026-01-07',
      },
    });

    expect(result).not.toHaveProperty('trend');
    expect(result).not.toHaveProperty('delta');
    expect(result).not.toHaveProperty('status');
  });
});