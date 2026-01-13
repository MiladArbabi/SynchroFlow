import { getOrderNexusFt2Coverage } from 'api-src/services/order-nexus-ft2/orderNexusFt2.coverage';

describe('Orders FT2 — Coverage Facts', () => {
  it('computes completenessPct correctly', async () => {
    const result = await getOrderNexusFt2Coverage({
      shopId: 1,
      period: { from: '2026-01-01', to: '2026-01-31' }
    });

    const expected =
      Math.round((result.presentCost / result.totalLineItems) * 100);

    if (result.totalLineItems === 0) {
      expect(result.completenessPct).toBeNull();
    } else {
      const expected = Math.round(
        (result.presentCost / result.totalLineItems) * 100
      );
      expect(result.completenessPct).toBe(expected);
    }
  });

  it('does not expose severity or interpretation', async () => {
    const result = await getOrderNexusFt2Coverage({
      shopId: 1,
      period: { from: '2026-01-01', to: '2026-01-31' }
    });

    expect(result).not.toHaveProperty('severity');
    expect(result).not.toHaveProperty('explanation');
  });
});