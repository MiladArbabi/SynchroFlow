import { render } from '@testing-library/react';
import OrdersTimeseriesWidget from 'apps/frontend/src/widgets/orders/OrdersTimeseriesWidget';

describe('Orders FT2 — Timeseries Widget', () => {
  it('renders zero explicitly', () => {
    const { getByText } = render(
      <OrdersTimeseriesWidget
        series={[{ date: '2026-01-01', ordersObserved: 0, revenueTotal: 0 }]}
      />
    );

    expect(getByText('0')).toBeInTheDocument();
  });

  it('does not render trend arrows or labels', () => {
    const { container } = render(
      <OrdersTimeseriesWidget series={[]} />
    );

    expect(container.textContent).not.toMatch(/up|down|increase|decrease/i);
  });
});