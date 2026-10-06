import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TopnavbarContent from 'layouts/AppLayout/TopnavbarContent';

const mockNavigate = jest.fn();
let mockRole = 'owner';
let mockUsage: any = null;

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

jest.mock('@mui/material/styles', () => ({
  ...jest.requireActual('@mui/material/styles'),
  useColorScheme: () => ({ mode: 'light', setMode: jest.fn() }),
}));

jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: mockRole } }),
}));

jest.mock('lifecycle/ShopLifecycleContext', () => ({
  useShopLifecycle: () => ({ phase: 'FT2_READY' }),
}));

jest.mock('contexts/integration/useIntegration', () => ({
  useIntegration: () => ({
    isSyncComplete: true,
    integrationId: 1,
    refresh: jest.fn(),
  }),
}));

jest.mock('pages/alerts/useAlerts', () => ({
  useAlerts: () => ({ data: { data: [], meta: { total: 0, status: 'inbox' } } }),
}));

jest.mock('hooks/useBillingUsage', () => ({
  useBillingUsage: () => ({ data: mockUsage }),
}));

jest.mock('components/OpsConsole', () => ({
  OpsConsoleButton: () => <div data-testid="ops-console" />,
}));

jest.mock('components/TrialCountdownChip', () => ({
  TrialCountdownChip: () => <div data-testid="trial-chip" />,
}));

jest.mock('api/axiosConfig', () => ({
  axiosInstance: { get: jest.fn(), post: jest.fn() },
}));

function renderTopnav() {
  return render(
    <MemoryRouter initialEntries={['/overview']}>
      <TopnavbarContent
        isEditing={false}
        onEditToggle={jest.fn()}
        onAddWidget={jest.fn()}
        onToggleSidenav={jest.fn()}
      />
    </MemoryRouter>
  );
}

describe('TopnavbarContent billing usage indicator', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockRole = 'owner';
    mockUsage = {
      tier: 'growth',
      processed_orders: 5700,
      shipped_orders: 5700,
      ingested_orders: 0,
      included_allowance: 7500,
      remaining_included: 1800,
      usage_percent: 76,
      overage_units: 0,
      overage_rate_cents: 6,
      estimated_overage_cents: 0,
      period_starts_at: '2026-09-01T00:00:00Z',
      period_ends_at: '2026-10-01T00:00:00Z',
    };
  });

  it('<60 is hidden and owner 76% shows compact indicator/popover/action', async () => {
    mockUsage = { ...mockUsage, usage_percent: 59 };
    const { rerender } = renderTopnav();
    expect(screen.queryByText('59%')).not.toBeInTheDocument();

    mockUsage = { ...mockUsage, usage_percent: 76 };
    rerender(
      <MemoryRouter initialEntries={['/overview']}>
        <TopnavbarContent
          isEditing={false}
          onEditToggle={jest.fn()}
          onAddWidget={jest.fn()}
          onToggleSidenav={jest.fn()}
        />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByText('76%'));
    expect(await screen.findByText('5,700 / 7,500')).toBeInTheDocument();
    expect(screen.getByText('1,800 remaining')).toBeInTheDocument();
    expect(screen.getByText(/Additional orders after allowance: \$0\.06 each/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Go to billing →'));
    expect(mockNavigate).toHaveBeenCalledWith('/settings/billing');
  });

  it('does not render the retired trial countdown chip', () => {
    renderTopnav();

    expect(screen.queryByTestId('trial-chip')).not.toBeInTheDocument();
  });

  it('shows approaching allowance from 90 through below 100', async () => {
    mockUsage = {
      ...mockUsage,
      processed_orders: 7425,
      shipped_orders: 7425,
      usage_percent: 99,
      remaining_included: 75,
    };
    renderTopnav();

    fireEvent.click(screen.getByText('99%'));
    expect(await screen.findByText('Approaching your allowance')).toBeInTheDocument();
    expect(screen.getByText('7,425 / 7,500')).toBeInTheDocument();
    expect(screen.getByText('75 remaining')).toBeInTheDocument();
    expect(screen.queryByText('Included allowance used')).not.toBeInTheDocument();
    expect(screen.queryByText('Overage active')).not.toBeInTheDocument();
  });

  it('shows exact 100 as included allowance used without overage copy', async () => {
    mockUsage = {
      ...mockUsage,
      processed_orders: 7500,
      shipped_orders: 7500,
      usage_percent: 100,
      remaining_included: 0,
      overage_units: 0,
      estimated_overage_cents: 0,
    };
    renderTopnav();

    fireEvent.click(screen.getByText('100%'));
    expect(await screen.findByText('Included allowance used')).toBeInTheDocument();
    expect(screen.getByText('7,500 / 7,500')).toBeInTheDocument();
    expect(screen.getByText('Your included processed-order allowance has been used.')).toBeInTheDocument();
    expect(screen.getByText('Additional orders: $0.06 each')).toBeInTheDocument();
    expect(screen.getByText('Processing continues normally.')).toBeInTheDocument();
    expect(screen.queryByText('Approaching your allowance')).not.toBeInTheDocument();
    expect(screen.queryByText('Overage active')).not.toBeInTheDocument();
  });

  it('shows overage state capped at 100 and remains owner-only', async () => {
    mockUsage = {
      ...mockUsage,
      processed_orders: 7830,
      shipped_orders: 7830,
      usage_percent: 100,
      remaining_included: 0,
      overage_units: 330,
      estimated_overage_cents: 1980,
    };
    renderTopnav();

    fireEvent.click(screen.getByText('100%'));
    expect(await screen.findByText('Overage active')).toBeInTheDocument();
    expect(screen.getByText('7,830 processed orders')).toBeInTheDocument();
    expect(screen.getByText('330 additional')).toBeInTheDocument();
    expect(screen.getByText('Estimated overage $19.80')).toBeInTheDocument();
    expect(screen.queryByText('101%')).not.toBeInTheDocument();
    expect(screen.queryByText('104%')).not.toBeInTheDocument();

    mockRole = 'operator';
    const { container } = renderTopnav();
    expect(container).not.toHaveTextContent('100%');
  });
});
