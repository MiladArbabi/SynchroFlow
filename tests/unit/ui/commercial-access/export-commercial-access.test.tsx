// tests/unit/ui/commercial-access/export-commercial-access.test.tsx
//
// COMMERCIAL-ACCESS-ARCH-01 — Slice P0-A3-1 — TEST STRATEGY / RED
// =================================================================
// B (behavioral, jsdom) counterpart to
// tests/contract/export-commercial-access.contract.test.ts.
//
// Proves AUTHORITY, not a claim about the current canonical policy: every
// scenario below constructs a deliberate disagreement between the legacy
// tier/entitlement path and a mocked canonical AccessDecision, then asserts
// the canonical decision wins. This is never a claim that Starter (or any
// other tier) should actually be granted exports.core/exports.column_selection
// — it is a parity/authority proof only.
//
// Decision source is mocked at its public boundary (runtime/commercialContext's
// useCommercialAccess) rather than hand-reimplementing commercial policy.

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

jest.mock('hooks/useAppTheme', () => ({ useAppTheme: () => ({}) }));

const mockPost = jest.fn().mockResolvedValue({ data: 'stub' });
jest.mock('api/axiosConfig', () => ({
  axiosInstance: {
    get: jest.fn().mockResolvedValue({ data: {} }),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

jest.mock('api/entitlementDenial', () => ({ isEntitlementDenial: () => false }));

// Controlled canonical decision — set per test. Mocked at the shared
// adapter's public boundary (useCommercialAccess), never re-deriving tier/
// module/feature policy locally.
let mockDecide: (capabilityId: string) => { allowed: boolean; reason: string; requiredTier?: string };
jest.mock('runtime/commercialContext', () => ({
  __esModule: true,
  useCommercialAccess: () => ({
    context: { tier: 'starter', modules: new Set<string>(), flags: new Set<string>() },
    isResolved: true,
    decide: (capabilityId: string) => mockDecide(capabilityId),
  }),
}));

// Legacy usePlanEntitlement path — controlled per test (ColumnPicker only).
let mockCan: (feature: string) => boolean;
let mockMustUpgradeTo: (feature: string) => string | null;
jest.mock('hooks/usePlanEntitlement', () => ({
  usePlanEntitlement: () => ({
    tier: 'starter',
    can: (f: string) => mockCan(f),
    mustUpgradeTo: (f: string) => mockMustUpgradeTo(f),
  }),
}));

// ShopSettingsReportsPage's legacy tier source (ExportDrawer takes userTier
// as a prop instead — no EntitlementsContext needed for that component).
let mockTier = 'starter';
jest.mock('contexts/EntitlementsContext', () => ({
  useEntitlements: () => ({ tier: mockTier, billingCurrency: 'USD' }),
}));

import { ExportDrawer } from 'components/ExportDrawer';
import ShopSettingsReportsPage from 'pages/ft2-pages/ShopSettingsReportsPage';
import { ColumnPicker } from 'components/ColumnPicker';

const ALLOW = { allowed: true, reason: 'ALLOWED' as const };
const DENY_TIER_TOO_LOW = (requiredTier: string) => ({
  allowed: false, reason: 'TIER_TOO_LOW' as const, requiredTier,
});

beforeEach(() => {
  mockPost.mockClear();
  mockTier = 'starter';
  // Default the legacy ColumnPicker path to "entitled" so ExportDrawer/
  // ShopSettingsReportsPage tests (which render a nested ColumnPicker they
  // are not exercising) don't crash on an unset mock. A3E-U4 overrides
  // these explicitly to test ColumnPicker itself.
  mockCan = () => true;
  mockMustUpgradeTo = () => null;
});

// ===========================================================================
// A3E-U1 — ExportDrawer obeys the canonical exports.core decision (ALLOW case)
// ===========================================================================
describe('A3E-U1 — ExportDrawer obeys canonical exports.core decision (legacy DENY / canonical ALLOW)', () => {
  it('EXPECTED RED: legacy userTier says NOT eligible, canonical decision ALLOWs — download proceeds', async () => {
    mockDecide = () => ALLOW;
    const { container } = render(
      // ExportDrawer's Reports footer navigates, so it needs router context.
      <MemoryRouter>
        <ExportDrawer open onClose={() => {}} userTier="starter" reportIds={['orders-all']} />
      </MemoryRouter>,
    );
    const downloadIcon = container.querySelector('svg.lucide-download');
    expect(downloadIcon).not.toBeNull();
    fireEvent.click(downloadIcon!);
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
  });
});

// ===========================================================================
// A3E-U2 — canonical DENY cannot be bypassed by a permissive legacy tier
// ===========================================================================
describe('A3E-U2 — ExportDrawer canonical DENY cannot be bypassed by a permissive legacy tier', () => {
  it('EXPECTED RED: legacy userTier says eligible, canonical decision DENYs — download stays blocked', async () => {
    mockDecide = () => DENY_TIER_TOO_LOW('core');
    const { container } = render(
      // 'growth' would satisfy the legacy isTierSufficient('growth','core') check.
      <MemoryRouter>
        <ExportDrawer open onClose={() => {}} userTier="growth" reportIds={['orders-all']} />
      </MemoryRouter>,
    );
    const downloadIcon = container.querySelector('svg.lucide-download');
    expect(downloadIcon).not.toBeNull();
    fireEvent.click(downloadIcon!);
    // Give any (incorrect) async handler a tick to fire before asserting it didn't.
    await new Promise((r) => setTimeout(r, 0));
    expect(mockPost).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// A3E-U3 — Reports Hub (ShopSettingsReportsPage) obeys exports.core decision
// ===========================================================================
describe('A3E-U3 — ShopSettingsReportsPage obeys canonical exports.core decision (legacy DENY / canonical ALLOW)', () => {
  it('EXPECTED RED: legacy tier (starter) says NOT eligible, canonical decision ALLOWs — download proceeds', async () => {
    mockTier = 'starter';
    mockDecide = () => ALLOW;
    const { container } = render(<ShopSettingsReportsPage />);
    const downloadIcons = container.querySelectorAll('svg.lucide-download');
    expect(downloadIcons.length).toBeGreaterThan(0);
    fireEvent.click(downloadIcons[0]);
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
  });
});

// ===========================================================================
// A3E-U4 — ColumnPicker obeys exports.column_selection decision
// ===========================================================================
describe('A3E-U4 — ColumnPicker obeys canonical exports.column_selection decision', () => {
  it('EXPECTED RED: legacy usePlanEntitlement DENYs, canonical decision ALLOWs — column controls enabled', () => {
    mockCan = () => false;
    mockMustUpgradeTo = () => 'growth';
    mockDecide = () => ALLOW;
    render(
      <ColumnPicker
        endpoint="/api/v1/exports/orders"
        open
        onToggle={() => {}}
        onSelectionChange={() => {}}
      />,
    );
    // "Select all" / "Clear" only render when the picker considers the shop
    // entitled — legacy usePlanEntitlement says no, canonical says yes.
    expect(screen.queryByText(/select all/i)).not.toBeNull();
  });

  it('EXPECTED RED: legacy usePlanEntitlement ALLOWs, canonical decision DENYs — column controls stay locked (fail-closed)', () => {
    mockCan = () => true;
    mockMustUpgradeTo = () => null;
    mockDecide = () => DENY_TIER_TOO_LOW('growth');
    render(
      <ColumnPicker
        endpoint="/api/v1/exports/orders"
        open
        onToggle={() => {}}
        onSelectionChange={() => {}}
      />,
    );
    expect(screen.queryByText(/select all/i)).toBeNull();
  });
});
