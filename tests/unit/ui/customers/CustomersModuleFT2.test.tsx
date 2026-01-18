// tests/unit/ui/customers/CustomersModuleFT2.test.tsx
import { render, screen } from '@testing-library/react';
import { CustomersModuleFT2 } from '@lasyncro/customers';
import type { CustomersModuleFT2Props } from '@lasyncro/customers';

describe('CustomersModuleFT2 — FT2 truth exposure (canonical)', () => {
  it('renders only absence when no customer activity exists (FT2-Free)', () => {
    const props: CustomersModuleFT2Props = {
      sessionsObserved: null,
      period: null,
      activityDirection: null,
      exitIntentDetected: null,
      structuredJourneysDetected: null,
      dataCoverage: null,
      isPaid: false,
    };

    render(<CustomersModuleFT2 {...props} />);

    // Existence surface renders deterministically
    expect(
      screen.getByText(/customer activity detected/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/not detected/i)).toBeInTheDocument();

    // No paid-only surfaces
    expect(
      screen.queryByText(/early exits detected/i)
    ).toBeNull();
    expect(
      screen.queryByText(/structured journeys detected/i)
    ).toBeNull();

    // No directional signal
    expect(
      screen.queryByText(/customer activity movement/i)
    ).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();

    // Trust calibration still renders (explicit uncertainty)
    expect(
      screen.getByText(/all systems connected/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/unknown/i)).toBeInTheDocument();
  });

  it('renders full FT2-Free truth when activity exists', () => {
    const props: CustomersModuleFT2Props = {
      sessionsObserved: 120,
      period: { from: '2025-01-01', to: '2025-01-31' },
      activityDirection: 'flat',
      exitIntentDetected: null,
      structuredJourneysDetected: null,
      dataCoverage: 'complete',
      isPaid: false,
    };

    render(<CustomersModuleFT2 {...props} />);

    // Activity existence
    expect(
      screen.getByText('Customer activity detected')
    ).toBeInTheDocument();

    expect(
      screen.getByText(/^Detected$/)
    ).toBeInTheDocument();

    // Observation window
    expect(
      screen.getByText(/time period covered/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/2025-01-01 → 2025-01-31/i)
    ).toBeInTheDocument();

    // Directional signal
    expect(
      screen.getByText(/customer activity movement/i)
    ).toBeInTheDocument();
    expect(screen.getByText('→')).toBeInTheDocument();

    // Trust calibration
    expect(
      screen.getByText(/all systems connected/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/complete/i)).toBeInTheDocument();

    // Still no paid-only surfaces
    expect(
      screen.queryByText(/early exits detected/i)
    ).toBeNull();
    expect(
      screen.queryByText(/structured journeys detected/i)
    ).toBeNull();
  });

  it('renders paid-only structural truth when entitlement is enabled', () => {
  const props: CustomersModuleFT2Props = {
    sessionsObserved: 240,
    period: { from: '2025-02-01', to: '2025-02-28' },
    activityDirection: 'up',
    exitIntentDetected: true,
    structuredJourneysDetected: true,
    dataCoverage: 'partial',
    isPaid: true,
  };

  render(<CustomersModuleFT2 {...props} />);

  // Paid-only: early exits surface exists
  expect(
    screen.getByText('Early exits detected')
  ).toBeInTheDocument();
  expect(
    screen.getAllByText(/^Detected$/).length
  ).toBeGreaterThanOrEqual(1);

  // Paid-only: structured journeys surface exists
  expect(
    screen.getByText('Structured journeys detected')
  ).toBeInTheDocument();

  // Direction
  expect(screen.getByText('↑')).toBeInTheDocument();

  // Coverage still shown
  expect(screen.getByText(/partial/i)).toBeInTheDocument();
});
});
