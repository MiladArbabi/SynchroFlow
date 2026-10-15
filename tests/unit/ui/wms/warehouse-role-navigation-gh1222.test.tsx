// tests/unit/ui/wms/warehouse-role-navigation-gh1222.test.tsx
//
// GH-1222 / TIER-07 — TEST STRATEGY / RED — Warehouse tab role parity.
// ====================================================================
// Ratified Warehouse role matrix:
//
//                    OWNER / ADMIN                 OPERATOR
//   Operations       show                          SHOW
//   Floor Planning   show (subject to commercial)  HIDE
//   Analytics        show (subject to commercial)  HIDE
//   Problem Center   show                          SHOW
//
// Role-ineligible surfaces are HIDDEN BEFORE commercial lock/upsell logic: an
// operator never sees a tier badge or UpgradePrompt for a surface they are not
// role-eligible to use, and a commercial upgrade can never make a
// role-forbidden tab appear. GH-1209 (UNKNOWN commercial state != DENY) is
// preserved. Problem Center base access is operational (warehouse.operations);
// Growth-only Problem Center functionality is gated inside the surface.
//
// Harness mirrors commercial-readiness-gh1209.test.tsx: the REAL
// EntitlementsProvider is driven through its HTTP boundary
// (/api/v1/entitlements/me); useCommercialAccess, ModuleTabBar and
// WAREHOUSE_MODULE_TABS are production code. Only the AuthContext role and the
// UpgradePrompt rendering are stubbed.

import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { UpgradePromptProps } from 'components/UpgradePrompt';

type Role = 'owner' | 'admin' | 'operator';
let mockRole: Role = 'owner';
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
    // GH-1247: unsigned JWT-shaped token for shop 1222 ({ user_id: 1, shop_id: 1222 }).
    accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoxLCJzaG9wX2lkIjoxMjIyfQ.sig',
    user: { id: 1, shop_id: 1222, role: mockRole, first_name: 'Test', last_name: '', email: 'user@example.test' },
    logout: jest.fn(),
  }),
}));
jest.mock('hooks/useAppTheme', () => ({ useAppTheme: () => ({}) }));
jest.mock('components/UpgradePrompt', () => ({
  UpgradePrompt: (props: UpgradePromptProps) => (props.open
    ? (
      <div
        data-testid="upgrade-prompt"
        data-feature={props.featureName ?? ''}
        data-required-tier={props.decision?.requiredTier ?? props.requiredTier ?? ''}
      />
    )
    : null),
}));

import { EntitlementsProvider, useEntitlements } from 'contexts/EntitlementsContext';
import { ModuleTabBar } from 'components/ModuleTabBar';
import { WAREHOUSE_MODULE_TABS } from 'pages/ft2-pages/warehouseModuleTabs';

type Tier = 'starter' | 'core' | 'growth' | 'scale';
type EntitlementsFetch = 'pending' | { tier: Tier };

const TIER_LABEL = /^(Core|Growth|Scale)$/;
const ROLE_FORBIDDEN_FOR_OPERATOR = ['Floor Planning', 'Analytics'];
const OPERATOR_VISIBLE = ['Operations', 'Problem Center'];

function arrangeEntitlements(fetch: EntitlementsFetch) {
  mockGet.mockReset();
  if (fetch === 'pending') {
    mockGet.mockReturnValue(new Promise(() => {}));
    return;
  }
  mockGet.mockResolvedValue({
    data: {
      shopId: 1222,
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

function EntitlementsProbe() {
  const { hasResolved, error, tier } = useEntitlements();
  return <div data-testid="entitlements-probe">{`${hasResolved}|${error ?? ''}|${tier}`}</div>;
}

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

async function renderTabs(role: Role, fetch: EntitlementsFetch) {
  mockRole = role;
  arrangeEntitlements(fetch);
  render(
    <MemoryRouter initialEntries={['/wms']}>
      <EntitlementsProvider>
        <ModuleTabBar tabs={WAREHOUSE_MODULE_TABS} />
        <EntitlementsProbe />
        <LocationProbe />
      </EntitlementsProvider>
    </MemoryRouter>,
  );
  // Precondition: prove the commercial truth state the case claims to exercise.
  const probe = screen.getByTestId('entitlements-probe');
  if (fetch === 'pending') {
    await act(async () => {});
    expect(probe).toHaveTextContent(/^false\|\|starter$/);
  } else {
    await waitFor(() => expect(probe).toHaveTextContent(new RegExp(`^true\\|\\|${fetch.tier}$`)));
  }
}

/** The clickable ModuleTabBar tab for a label, or null when not rendered. */
function queryTab(label: string): HTMLElement | null {
  return screen.queryByText(label)?.parentElement ?? null;
}

const tierBadge = (el: HTMLElement) => within(el).queryByText(TIER_LABEL);

/** Click every rendered tab; collect the feature names of any UpgradePrompt opened. */
function promptedFeaturesAfterClickingEveryTab(): string[] {
  const opened: string[] = [];
  for (const { label } of WAREHOUSE_MODULE_TABS) {
    const el = queryTab(label);
    if (!el) continue;
    fireEvent.click(el);
    const prompt = screen.queryByTestId('upgrade-prompt');
    if (prompt) opened.push(prompt.getAttribute('data-feature') ?? '');
  }
  return opened;
}

function expectOperatorRoleVisibility() {
  for (const label of OPERATOR_VISIBLE) {
    expect(queryTab(label)).not.toBeNull();
  }
  for (const label of ROLE_FORBIDDEN_FOR_OPERATOR) {
    expect(queryTab(label)).toBeNull();
  }
}

describe('GH-1222 B1 — OPERATOR @ Core', () => {
  it('B1 EXPECTED RED: Operations + Problem Center visible; Floor Planning + Analytics absent', async () => {
    await renderTabs('operator', { tier: 'core' });
    expectOperatorRoleVisibility();
  });

  it('B1 EXPECTED RED: no tier badge anywhere for a role-forbidden surface', async () => {
    await renderTabs('operator', { tier: 'core' });
    // Floor Planning is the only role-forbidden tab that is commercially
    // denied at Core; today it renders with a Growth badge for the operator.
    expect(screen.queryAllByText('Growth')).toHaveLength(0);
    expect(queryTab('Floor Planning')).toBeNull();
  });

  it('B1 EXPECTED RED: no UpgradePrompt can be opened for Floor Planning or Analytics', async () => {
    await renderTabs('operator', { tier: 'core' });
    const prompted = promptedFeaturesAfterClickingEveryTab();
    expect(prompted.filter((f) => /Floor Planning|Analytics/.test(f))).toEqual([]);
    expect(screen.queryByText('Floor Planning')).toBeNull();
    expect(screen.queryByText('Analytics')).toBeNull();
  });
});

describe('GH-1222 B2 — OPERATOR @ Growth / Scale: commercial upgrade never reveals a role-forbidden tab', () => {
  it.each(['growth', 'scale'] as const)('B2 EXPECTED RED: operator @ %s — same role visibility', async (tier) => {
    await renderTabs('operator', { tier });
    expectOperatorRoleVisibility();
  });
});

describe('GH-1222 B3 — OWNER / ADMIN @ Growth keep all four Warehouse tabs', () => {
  it.each(['owner', 'admin'] as const)('B3 GREEN CONTROL: %s @ Growth sees all four tabs without a paygate', async (role) => {
    await renderTabs(role, { tier: 'growth' });
    for (const { label } of WAREHOUSE_MODULE_TABS) {
      const el = queryTab(label);
      expect(el).not.toBeNull();
      expect(tierBadge(el as HTMLElement)).toBeNull();
    }
  });

  it('B3 GREEN CONTROL: owner @ Core keeps the Floor Planning Growth upsell (commercial authority unchanged)', async () => {
    await renderTabs('owner', { tier: 'core' });
    const fp = queryTab('Floor Planning') as HTMLElement;
    expect(tierBadge(fp)).toHaveTextContent('Growth');

    fireEvent.click(fp);
    expect(screen.getByTestId('upgrade-prompt')).toHaveAttribute('data-required-tier', 'growth');
    expect(screen.getByTestId('location')).toHaveTextContent('/wms');
  });
});

describe('GH-1222 B4 — commercial UNKNOWN (GH-1209 preserved)', () => {
  it.each(['owner', 'operator'] as const)(
    'B4 GREEN CONTROL: %s while commercial truth is pending — no speculative badge and no upsell on any rendered tab',
    async (role) => {
      await renderTabs(role, 'pending');
      for (const { label } of WAREHOUSE_MODULE_TABS) {
        const el = queryTab(label);
        if (el) expect(tierBadge(el)).toBeNull();
      }
      expect(promptedFeaturesAfterClickingEveryTab()).toEqual([]);
    },
  );

  it('B4 EXPECTED RED: operator role visibility applies even while commercial truth is pending', async () => {
    await renderTabs('operator', 'pending');
    expectOperatorRoleVisibility();
  });
});

describe('GH-1222 B5 — Problem Center base tab is operational (warehouse.operations)', () => {
  it.each(['owner', 'admin', 'operator'] as const)(
    'B5 EXPECTED RED: %s @ Core — Problem Center carries no Growth paygate and navigates to /problem-center',
    async (role) => {
      await renderTabs(role, { tier: 'core' });
      const pc = queryTab('Problem Center');
      expect(pc).not.toBeNull();
      expect(tierBadge(pc as HTMLElement)).toBeNull();

      fireEvent.click(pc as HTMLElement);
      expect(screen.queryByTestId('upgrade-prompt')).toBeNull();
      expect(screen.getByTestId('location')).toHaveTextContent('/problem-center');
    },
  );
});
