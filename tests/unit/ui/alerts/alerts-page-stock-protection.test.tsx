// tests/unit/ui/alerts/alerts-page-stock-protection.test.tsx
//
// STOCK-PROTECT-03 Slice 3B — AlertsPage renders CTAs strictly from the
// canonical shared alertDeepLink() resolver, never a duplicate local map,
// and never invents a Stock Protection CTA when the backend supplies none.
// PERMANENT regression contract.
//
// Mocks only network/context boundaries not relevant to this contract
// (axios, auth, currency, tab bar) — renders the REAL AlertsPage.

import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from 'test-utils';
import AlertsPage from 'pages/ft2-pages/AlertsPage';
import { axiosInstance } from 'api/axiosConfig';
import type { Alert } from 'pages/alerts/useAlerts';

jest.mock('api/axiosConfig', () => ({
  axiosInstance: { get: jest.fn(), post: jest.fn() },
}));

jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'owner', userId: 1 }, isAuthenticated: true, logout: jest.fn() }),
}));

jest.mock('hooks/useCurrency', () => ({
  useCurrency: () => ({
    format: (n: number | null) => (n == null ? '' : `$${n}`),
    formatCompact: (n: number | null) => (n == null ? '' : `$${n}`),
    displayCurrency: 'USD',
    locale: 'en-US',
    ratesAreStale: false,
  }),
}));

jest.mock('components/ModuleTabBar', () => ({
  ModuleTabBar: () => null,
}));

jest.mock('components/AlertRulesPanel', () => ({
  __esModule: true,
  default: () => null,
}));

const mockedGet = axiosInstance.get as jest.Mock;

function alertRow(over: Partial<Alert> = {}): Alert {
  return {
    id: 'a1',
    alert_key: 'k',
    source: 'projection',
    alert_type: 'stock_protection',
    severity: 'critical',
    title: 'Fixture SP title',
    message: 'Fixture SP message',
    entity_id: 'variant-1',
    entity_type: 'variant',
    revenue_impact: null,
    category: 'stock_reorder',
    audience: 'all',
    is_active: true,
    dismissed_at: null,
    resolved_at: null,
    acknowledged_at: null,
    acknowledged_by: null,
    snoozed_until: null,
    escalated_at: null,
    rule_id: null,
    created_at: '2026-09-13T10:00:00.000Z',
    updated_at: '2026-09-13T10:00:00.000Z',
    treatment: null,
    action: null,
    ...over,
  };
}

function mockAlertsResponse(data: Alert[]) {
  mockedGet.mockResolvedValue({ data: { data, meta: { total: data.length, status: 'inbox' } } });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AlertsPage — stock_protection CTA rendering', () => {
  it('D: actionable stock_protection renders the backend-derived CTA label', async () => {
    mockAlertsResponse([
      alertRow({
        treatment: 'reorder_now',
        action: {
          key: 'stock_protection_reorder_now',
          label: 'Reorder now',
          route: '/suppliers-portal/sourcing?variantId=variant-1',
          module: 'suppliers-portal',
        },
      }),
    ]);

    renderWithProviders(<AlertsPage />);

    expect(await screen.findByText('Fixture SP title')).toBeInTheDocument();
    expect(screen.getByText(/Go to Reorder now/)).toBeInTheDocument();
  });

  it('E: complete_setup / action=null renders no CTA and no broken button', async () => {
    mockAlertsResponse([
      alertRow({ treatment: 'complete_setup', action: null }),
    ]);

    renderWithProviders(<AlertsPage />);

    expect(await screen.findByText('Fixture SP title')).toBeInTheDocument();
    expect(screen.queryByText(/Go to /)).not.toBeInTheDocument();
    // Still fully functional otherwise — the standard lifecycle actions render.
    expect(screen.getByText('Acknowledge')).toBeInTheDocument();
  });

  it('E2: commercially-denied reorder_now (action=null despite a real treatment) renders no CTA', async () => {
    mockAlertsResponse([
      alertRow({ treatment: 'reorder_now', action: null }),
    ]);

    renderWithProviders(<AlertsPage />);

    expect(await screen.findByText('Fixture SP title')).toBeInTheDocument();
    expect(screen.queryByText(/Go to /)).not.toBeInTheDocument();
  });

  it('legacy alert routing is unchanged: stockout_risk still renders "Go to Sourcing"', async () => {
    mockAlertsResponse([
      alertRow({
        alert_type: 'stockout_risk',
        title: 'Legacy stockout title',
        treatment: undefined,
        action: undefined,
      }),
    ]);

    renderWithProviders(<AlertsPage />);

    expect(await screen.findByText('Legacy stockout title')).toBeInTheDocument();
    expect(screen.getByText(/Go to Sourcing/)).toBeInTheDocument();
  });
});

describe('AlertsPage — canonical routing source (no duplicate table)', () => {
  it('I: does not define its own ALERT_ROUTE_MAP / buildDeepLink — imports the canonical resolver', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../../../apps/frontend/src/pages/ft2-pages/AlertsPage.tsx'),
      'utf8',
    );

    expect(source).not.toMatch(/const ALERT_ROUTE_MAP/);
    expect(source).not.toMatch(/function buildDeepLink/);
    expect(source).toMatch(/import \{ alertDeepLink \} from '..\/alerts\/alertDeepLink'/);
  });
});
