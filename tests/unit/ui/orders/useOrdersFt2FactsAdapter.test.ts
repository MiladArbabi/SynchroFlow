import { mapOrdersFt2TimeseriesProps } from 'apps/frontend/src/pages/orders/useOrdersFt2TimeseriesAdapter';

describe('Orders FT2 — Fact Adapter Purity', () => {
  it('normalizes undefined to null only', () => {
    const result = mapOrdersFt2TimeseriesProps({});

    expect(result.series).toBeNull();
  });

  it('does not derive or compute new values', () => {
    const input = {
      series: [
        {
          date: '2026-01-01',
          ordersObserved: 0,
          revenueTotal: 0,
        },
      ],
    };
    const result = mapOrdersFt2TimeseriesProps(input);

    expect(result).toEqual(input);
  });
});