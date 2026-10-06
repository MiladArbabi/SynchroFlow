import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

type Tier = 'starter' | 'core' | 'growth' | 'scale';

let mockTier: Tier = 'growth';
let mockCommercialResolved = true;
let mockSubscriptionStatus: string | null = 'trialing';
let mockBillingProvider: 'stripe' | 'shopify' | null = 'shopify';
let mockEntitlementsResolved = true;
let mockEntitlementsError: string | null = null;

jest.mock('runtime/useResolvedNavigation', () => ({
  useResolvedNavigation: () => ({ groups: [] }),
}));

jest.mock('runtime/useModuleHealth', () => ({
  useModuleHealth: () => new Map(),
}));

jest.mock('pages/alerts/useAlerts', () => ({
  useAlerts: () => ({ data: undefined }),
}));

jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({
    user: {
      role: 'owner',
      first_name: 'Milad',
      last_name: '',
      email: 'contact@lasyncro.com',
    },
    logout: jest.fn(),
  }),
}));

jest.mock('runtime/commercialContext', () => ({
  useCommercialAccess: () => ({
    context: {
      tier: mockTier,
      modules: new Set<string>(),
      flags: new Set<string>(),
    },
    isResolved: mockCommercialResolved,
    decide: jest.fn(),
  }),
}));

jest.mock('contexts/EntitlementsContext', () => ({
  useEntitlements: () => ({
    subscriptionStatus: mockSubscriptionStatus,
    billingProvider: mockBillingProvider,
    hasResolved: mockEntitlementsResolved,
    error: mockEntitlementsError,
  }),
}));

jest.mock('api/axiosConfig', () => ({
  axiosInstance: { post: jest.fn() },
}));

jest.mock('ui-component/third-party/SimpleBar', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="module-scroll">{children}</div>
  ),
}));

jest.mock('components/UpgradePrompt', () => ({
  UpgradePrompt: () => null,
}));

jest.mock('components/ThemeToggle', () => ({
  ThemeToggle: () => <div data-testid="theme-toggle" />,
}));

import SidenavContent from 'layouts/AppLayout/SidenavContent';

function LocationProbe() {
  const location = useLocation();
  const state = location.state as
    | { backgroundLocation?: { pathname?: string } }
    | null;

  return (
    <div data-testid="location-probe">
      {JSON.stringify({
        pathname: location.pathname,
        backgroundPathname: state?.backgroundLocation?.pathname ?? null,
      })}
    </div>
  );
}

function renderSidenav(
  sidenavState: 'EXPANDED' | 'COMPACT' = 'EXPANDED',
) {
  return render(
    <MemoryRouter initialEntries={['/overview']}>
      <SidenavContent
        brandName="LaSyncro"
        routes={[]}
        sidenavState={sidenavState}
        isConnected
        isFt2Ready
      />
      <LocationProbe />
    </MemoryRouter>,
  );
}

function billingCard(): HTMLElement {
  const title = screen.getByText('Billing setup');
  const clickable = title.closest('button,[role="button"]');

  expect(clickable).not.toBeNull();

  return clickable as HTMLElement;
}

beforeEach(() => {
  mockTier = 'growth';
  mockCommercialResolved = true;
  mockSubscriptionStatus = 'trialing';
  mockBillingProvider = 'shopify';
  mockEntitlementsResolved = true;
  mockEntitlementsError = null;
});

describe('Billing setup card — ratified sidenav 3b', () => {
  it('shows for an unresolved Growth trial and preserves the ratified compact copy', () => {
    renderSidenav();

    expect(screen.getByText('Billing setup')).toBeInTheDocument();
    expect(screen.getByText('Complete your plan setup')).toBeInTheDocument();
    expect(screen.getByText('Set up')).toBeInTheDocument();
  });

  it('remains visible for Starter active because Starter does not mean billing is configured', () => {
    mockTier = 'starter';
    mockSubscriptionStatus = 'active';

    renderSidenav();

    expect(screen.getByText('Billing setup')).toBeInTheDocument();
  });

  it.each([
    ['core', 'stripe'],
    ['growth', 'shopify'],
    ['scale', 'shopify'],
  ] as const)(
    'is absent for paid %s + active + resolved %s billing',
    (tier, provider) => {
      mockTier = tier;
      mockSubscriptionStatus = 'active';
      mockBillingProvider = provider;

      renderSidenav();

      expect(screen.queryByText('Billing setup')).not.toBeInTheDocument();
    },
  );

  it('remains visible for paid + active when the billing provider is unresolved', () => {
    mockTier = 'growth';
    mockSubscriptionStatus = 'active';
    mockBillingProvider = null;

    renderSidenav();

    expect(screen.getByText('Billing setup')).toBeInTheDocument();
  });

  it('remains visible for a paid tier whose subscription is no longer active', () => {
    mockTier = 'core';
    mockSubscriptionStatus = 'past_due';
    mockBillingProvider = 'stripe';

    renderSidenav();

    expect(screen.getByText('Billing setup')).toBeInTheDocument();
  });

  it('fails closed while billing/commercial truth is unresolved or errored', () => {
    mockEntitlementsResolved = false;
    const first = renderSidenav();

    expect(screen.queryByText('Billing setup')).not.toBeInTheDocument();

    first.unmount();

    mockEntitlementsResolved = true;
    mockEntitlementsError = 'billing truth unavailable';

    renderSidenav();

    expect(screen.queryByText('Billing setup')).not.toBeInTheDocument();
  });

  it('does not invent a compact-rail billing treatment', () => {
    renderSidenav('COMPACT');

    expect(screen.queryByText('Billing setup')).not.toBeInTheDocument();
    expect(screen.queryByText('Complete your plan setup')).not.toBeInTheDocument();
  });

  it('is outside the module scroller, immediately before footer controls, and has no dismiss action', () => {
    renderSidenav();

    const card = billingCard();
    const scroll = screen.getByTestId('module-scroll');
    const theme = screen.getByTestId('theme-toggle');

    expect(scroll).not.toContainElement(card);
    expect(
      Boolean(
        card.compareDocumentPosition(theme) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);

    expect(
      screen.queryByRole('button', { name: /dismiss|close/i }),
    ).not.toBeInTheDocument();
  });

  it('uses the whole card as the action and preserves Settings modal background-location semantics', () => {
    renderSidenav();

    fireEvent.click(billingCard());

    const location = JSON.parse(
      screen.getByTestId('location-probe').textContent ?? '{}',
    );

    expect(location).toEqual({
      pathname: '/settings/billing',
      backgroundPathname: '/overview',
    });
  });
});
