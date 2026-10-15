// tests/unit/ui/commercial-access/commercial-readiness-gh1209.test.tsx
//
// GH-1209 — TEST STRATEGY / RED — commercial readiness on navigation surfaces
// ===========================================================================
// Ratified contract: commercial state is UNKNOWN | RESOLVED ALLOW | RESOLVED
// DENY. UNKNOWN must never be presented as DENY. While commercial truth is
// unresolved (or the entitlement fetch failed with no prior good snapshot),
// navigation must show no Core/Growth paygate badge, no plan-driven locked
// styling, and a click must not open an UpgradePrompt. After valid
// resolution, genuine DENY keeps the badge/lock/upgrade UX and genuine ALLOW
// keeps ordinary navigation.
//
// Harness: the REAL EntitlementsProvider is driven through its HTTP boundary
// (/api/v1/entitlements/me). useCommercialAccess, useResolvedNavigation,
// resolveNavigation, resolveNavVisibility, the bootstrapped nav registry,
// SidenavContent and ModuleTabBar are all production code. Only incidental
// UI dependencies and the UpgradePrompt rendering are stubbed.

import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { UpgradePromptProps } from 'components/UpgradePrompt';

const mockGet = jest.fn();

jest.mock('api/axiosConfig', () => ({
  axiosInstance: {
    get: (...args: unknown[]) => mockGet(...args),
    post: jest.fn(),
  },
}));
jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({
    isLoggedIn: true,
    // GH-1247: unsigned JWT-shaped token for shop 1209 ({ user_id: 1, shop_id: 1209 }).
    accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoxLCJzaG9wX2lkIjoxMjA5fQ.sig',
    user: { role: 'owner', first_name: 'Test', last_name: '', email: 'owner@example.test' },
    logout: jest.fn(),
  }),
}));
jest.mock('hooks/useAppTheme', () => ({ useAppTheme: () => ({}) }));
jest.mock('runtime/useModuleHealth', () => ({ useModuleHealth: () => new Map() }));
jest.mock('pages/alerts/useAlerts', () => ({ useAlerts: () => ({ data: undefined }) }));
jest.mock('components/ThemeToggle', () => ({ ThemeToggle: () => null }));
jest.mock('ui-component/third-party/SimpleBar', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('components/UpgradePrompt', () => ({
  UpgradePrompt: (props: UpgradePromptProps) => (props.open
    ? <div data-testid="upgrade-prompt" data-required-tier={props.decision?.requiredTier ?? props.requiredTier ?? ''} />
    : null),
}));

import { EntitlementsProvider, useEntitlements } from 'contexts/EntitlementsContext';
import { ShopLifecycleContext } from '../../../../apps/frontend/src/lifecycle/ShopLifecycleContext';
import { bootstrapNavGroups } from '../../../../apps/frontend/src/runtime/navBootstrap';
import { _resetNav } from '../../../../apps/frontend/src/runtime/registerNav';
import SidenavContent from '../../../../apps/frontend/src/layouts/AppLayout/SidenavContent';
import { ModuleTabBar } from 'components/ModuleTabBar';
import { WAREHOUSE_MODULE_TABS } from 'pages/ft2-pages/warehouseModuleTabs';

type Tier = 'starter' | 'core' | 'growth' | 'scale';
type EntitlementsFetch = 'pending' | 'error' | { tier: Tier };

const LIFECYCLE = {
  phase: 'FT2_READY',
  readiness: { ready: true },
  isBooting: false,
  integrationExists: true,
} as React.ContextType<typeof ShopLifecycleContext>;

const TIER_LABEL = /^(Core|Growth|Scale)$/;
const LOCKED_OPACITY = '0.6';

function arrangeEntitlements(fetch: EntitlementsFetch) {
  mockGet.mockReset();
  if (fetch === 'pending') {
    mockGet.mockReturnValue(new Promise(() => {}));
  } else if (fetch === 'error') {
    mockGet.mockRejectedValue(new Error('Network Error'));
  } else {
    mockGet.mockResolvedValue({
      data: {
        shopId: 1209,
        modules: [],
        flags: [],
        tier: fetch.tier,
        trialEndsAt: null,
        subscriptionStatus: 'active',
        displayCurrency: 'USD',
        locale: 'en-US',
        billingCurrency: 'USD',
        billingProvider: 'shopify',
      },
    });
  }
}

function EntitlementsProbe() {
  const { hasResolved, error, tier } = useEntitlements();
  return <div data-testid="entitlements-probe">{`${hasResolved}|${error ?? ''}|${tier}`}</div>;
}

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

async function renderSurface(fetch: EntitlementsFetch, surface: React.ReactNode, route = '/wms') {
  arrangeEntitlements(fetch);
  render(
    <MemoryRouter initialEntries={[route]}>
      <ShopLifecycleContext.Provider value={LIFECYCLE}>
        <EntitlementsProvider>
          {surface}
          <EntitlementsProbe />
          <LocationProbe />
        </EntitlementsProvider>
      </ShopLifecycleContext.Provider>
    </MemoryRouter>,
  );
  // Precondition: prove the commercial truth state the case claims to exercise.
  const probe = screen.getByTestId('entitlements-probe');
  if (fetch === 'pending') {
    await act(async () => {});
    expect(probe).toHaveTextContent(/^false\|\|starter$/);
  } else if (fetch === 'error') {
    await waitFor(() => expect(probe).toHaveTextContent(/^true\|Network Error\|starter$/));
  } else {
    await waitFor(() => expect(probe).toHaveTextContent(new RegExp(`^true\\|\\|${fetch.tier}$`)));
  }
}

const renderSidenav = (fetch: EntitlementsFetch) => renderSurface(
  fetch,
  <SidenavContent brandName="laSyncro" routes={[]} sidenavState="EXPANDED" isConnected isFt2Ready />,
);
const renderTabs = (fetch: EntitlementsFetch) => renderSurface(fetch, <ModuleTabBar tabs={WAREHOUSE_MODULE_TABS} />);

/** The clickable sidenav row (ListItemButton) for a visible nav title. */
function navRow(title: string): HTMLElement {
  const row = screen.getByText(title, { selector: 'p, span' }).closest('[role="button"]');
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

/** The clickable ModuleTabBar tab for a visible tab label. */
function tab(label: string): HTMLElement {
  return screen.getByText(label).parentElement as HTMLElement;
}

const tierBadge = (el: HTMLElement) => within(el).queryByText(TIER_LABEL);

beforeEach(() => {
  _resetNav();
  bootstrapNavGroups();
});

// Warehouse parent + every Warehouse child; all are DENY for the Starter-shaped
// defaults under canonical policy (operations/analytics Core+, floor planning
// and problem center Growth+).
const SIDENAV_WAREHOUSE_ROWS = ['Warehouse', 'Operations', 'Floor Planning', 'Analytics', 'Problem Center'];

describe('GH-1209 A — Sidenav while commercial truth is UNRESOLVED', () => {
  it.each(SIDENAV_WAREHOUSE_ROWS)('EXPECTED RED: %s shows no speculative tier badge and no plan-driven locked styling', async (title) => {
    await renderSidenav('pending');
    const row = navRow(title);
    expect(tierBadge(row)).toBeNull();
    expect(row).not.toHaveStyle({ opacity: LOCKED_OPACITY });
  });

  it.each(SIDENAV_WAREHOUSE_ROWS)('EXPECTED RED: clicking pending %s does not open UpgradePrompt', async (title) => {
    await renderSidenav('pending');
    fireEvent.click(navRow(title));
    expect(screen.queryByTestId('upgrade-prompt')).toBeNull();
  });
});

describe('GH-1209 B — Sidenav RESOLVED DENY control', () => {
  it('GREEN CONTROL: resolved Starter keeps Warehouse Core lock, badge and upgrade prompt', async () => {
    await renderSidenav({ tier: 'starter' });
    const row = navRow('Warehouse');
    expect(tierBadge(row)).toHaveTextContent('Core');
    expect(row).toHaveStyle({ opacity: LOCKED_OPACITY });

    fireEvent.click(row);
    expect(screen.getByTestId('upgrade-prompt')).toHaveAttribute('data-required-tier', 'core');
    expect(screen.getByTestId('location')).toHaveTextContent('/wms');
  });

  // GH-1222: Problem Center was removed from this list. Its BASE navigation is
  // operational (warehouse.operations, Core+) under the ratified compositional
  // Problem Center contract — see the GH-1222 case below. Floor Planning keeps
  // its Growth lock unchanged.
  it.each([
    ['Floor Planning', 'Growth', 'growth'],
  ])('GREEN CONTROL: resolved Core keeps %s locked with its %s badge and upgrade prompt', async (title, badge, requiredTier) => {
    await renderSidenav({ tier: 'core' });
    const row = navRow(title);
    expect(tierBadge(row)).toHaveTextContent(badge);
    expect(row).toHaveStyle({ opacity: LOCKED_OPACITY });

    fireEvent.click(row);
    expect(screen.getByTestId('upgrade-prompt')).toHaveAttribute('data-required-tier', requiredTier);
    expect(screen.getByTestId('location')).toHaveTextContent('/wms');
  });
});

describe('GH-1222 — Problem Center base navigation is operational (supersedes the GH-1209 B Growth lock)', () => {
  it('EXPECTED RED: resolved Core shows Problem Center without a Growth paygate and navigates to /problem-center', async () => {
    await renderSidenav({ tier: 'core' });
    const row = navRow('Problem Center');
    expect(tierBadge(row)).toBeNull();
    expect(row).not.toHaveStyle({ opacity: LOCKED_OPACITY });

    fireEvent.click(row);
    expect(screen.queryByTestId('upgrade-prompt')).toBeNull();
    expect(screen.getByTestId('location')).toHaveTextContent('/problem-center');
  });
});

describe('GH-1209 C — Sidenav RESOLVED ALLOW control', () => {
  it('GREEN CONTROL: resolved Growth shows no paygate on Warehouse rows and navigates normally', async () => {
    await renderSidenav({ tier: 'growth' });
    for (const title of SIDENAV_WAREHOUSE_ROWS) {
      expect(tierBadge(navRow(title))).toBeNull();
      expect(navRow(title)).not.toHaveStyle({ opacity: LOCKED_OPACITY });
    }

    fireEvent.click(navRow('Floor Planning'));
    expect(screen.queryByTestId('upgrade-prompt')).toBeNull();
    expect(screen.getByTestId('location')).toHaveTextContent('/floor-planning');
  });
});

describe('GH-1209 D — ModuleTabBar while commercial truth is UNRESOLVED', () => {
  it.each(['Operations', 'Floor Planning', 'Problem Center'])(
    'EXPECTED RED: %s tab shows no speculative tier badge',
    async (label) => {
      await renderTabs('pending');
      expect(tierBadge(tab(label))).toBeNull();
    },
  );

  it.each(['Operations', 'Floor Planning', 'Problem Center'])(
    'EXPECTED RED: clicking pending %s tab does not open UpgradePrompt',
    async (label) => {
      await renderTabs('pending');
      fireEvent.click(tab(label));
      expect(screen.queryByTestId('upgrade-prompt')).toBeNull();
    },
  );
});

describe('GH-1209 E — ModuleTabBar RESOLVED controls', () => {
  it('GREEN CONTROL: resolved Core keeps the Floor Planning Growth badge and upgrade prompt without navigating', async () => {
    await renderTabs({ tier: 'core' });
    expect(tierBadge(tab('Floor Planning'))).toHaveTextContent('Growth');

    fireEvent.click(tab('Floor Planning'));
    expect(screen.getByTestId('upgrade-prompt')).toHaveAttribute('data-required-tier', 'growth');
    expect(screen.getByTestId('location')).toHaveTextContent('/wms');
  });

  it('GREEN CONTROL: resolved Growth navigates from the Floor Planning tab without a prompt', async () => {
    await renderTabs({ tier: 'growth' });
    expect(tierBadge(tab('Floor Planning'))).toBeNull();

    fireEvent.click(tab('Floor Planning'));
    expect(screen.queryByTestId('upgrade-prompt')).toBeNull();
    expect(screen.getByTestId('location')).toHaveTextContent('/floor-planning');
  });
});

describe('GH-1209 F — failed entitlement fetch is not a confirmed tier denial', () => {
  it('EXPECTED RED: Sidenav Warehouse shows no Core paygate and no UpgradePrompt after a failed fetch', async () => {
    await renderSidenav('error');
    const row = navRow('Warehouse');
    expect(tierBadge(row)).toBeNull();

    fireEvent.click(row);
    expect(screen.queryByTestId('upgrade-prompt')).toBeNull();
  });

  it('EXPECTED RED: Floor Planning tab shows no Growth paygate and no UpgradePrompt after a failed fetch', async () => {
    await renderTabs('error');
    expect(tierBadge(tab('Floor Planning'))).toBeNull();

    fireEvent.click(tab('Floor Planning'));
    expect(screen.queryByTestId('upgrade-prompt')).toBeNull();
  });
});
