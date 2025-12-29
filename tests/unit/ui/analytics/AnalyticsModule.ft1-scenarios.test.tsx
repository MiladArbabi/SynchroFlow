import { render, screen } from '@testing-library/react';
import AnalyticsModule from '@lasyncro/analytics';

describe('AnalyticsModule FT1 scenarios', () => {
  it('renders LOADING state', () => {
    render(
      <AnalyticsModule
        orderCount={null}
        productCount={1}
        baseSignalsReady={true}
      />
    );

    expect(
      screen.getByText(/loading/i)
    ).toBeInTheDocument();
  });

  it('renders NO_BASE_DATA state', () => {
    render(
      <AnalyticsModule
        orderCount={0}
        productCount={5}
        baseSignalsReady={true}
      />
    );

    expect(
      screen.getByText(/insights unavailable/i)
    ).toBeInTheDocument();
  });

  it('renders PARTIAL_DATA state', () => {
    render(
      <AnalyticsModule
        orderCount={3}
        productCount={5}
        baseSignalsReady={false}
      />
    );

    expect(
      screen.getByText(/incomplete data/i)
    ).toBeInTheDocument();
  });

  it('renders HEALTHY state', () => {
    render(
      <AnalyticsModule
        orderCount={3}
        productCount={5}
        baseSignalsReady={true}
      />
    );

    expect(
      screen.getByText(/analytics ready/i)
    ).toBeInTheDocument();
  });
});
