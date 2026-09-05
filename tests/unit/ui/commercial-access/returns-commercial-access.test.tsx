// tests/unit/ui/commercial-access/returns-commercial-access.test.tsx
//
// COMMERCIAL-ACCESS-ARCH-01 — Slice P0-A3-3 — TEST STRATEGY / RED
// ===============================================================
// Behavioural (jsdom) counterpart to
// tests/contract/returns-commercial-access.contract.test.ts.
//
// Covers brief sections E (ReturnsOverviewPage) and F (ReturnsSuppliersPage).
//
// Every scenario constructs a deliberate DISAGREEMENT between the legacy tier
// and a mocked canonical returns.analysis AccessDecision, then asserts the
// canonical decision wins. This is an AUTHORITY proof, never a claim about
// what any given tier should actually be granted — the same pattern as
// tests/unit/ui/commercial-access/overview-live-map-commercial-access.test.tsx
// and export-commercial-access.test.tsx.
//
// The decision source is mocked at its public boundary
// (runtime/commercialContext's useCommercialAccess); tier/module/feature policy
// is never re-implemented locally.
//
// ACQUISITION is observed at the useReturnsCorrelation module boundary: the
// contract under test is that a denied tenant must not FETCH /correlation, not
// merely that the section is hidden.

import React from 'react';
import { render, screen } from '@testing-library/react';

const mockNavigate = jest.fn();
const mockUseReturns = jest.fn();
const mockUseReturnsCorrelation = jest.fn();
const mockUseCommercialAccess = jest.fn();

// Real routing primitives (Routes/Route/MemoryRouter) are required by the
// direct-route cases below; only useNavigate is doubled, so the page-level
// cases still render without a Router exactly as before.
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

// Legacy tier source — set per test, deliberately disagreeing with the mocked
// canonical decision below.
let mockTier: 'starter' | 'core' | 'growth' | 'scale' = 'core';
jest.mock('contexts/EntitlementsContext', () => ({
  useEntitlements: () => ({
    displayCurrency: 'USD',
    tier: mockTier,
    hasResolved: true,
  }),
}));

// Controlled canonical decision — set per test.
let mockDecide: (capabilityId: string) => {
  allowed: boolean;
  reason: string;
  requiredTier?: string;
};
jest.mock('runtime/commercialContext', () => ({
  __esModule: true,
  useCommercialAccess: () => mockUseCommercialAccess(),
}));

// Shared correlation hook — the acquisition boundary under test. The `enabled`
// argument is captured so the test can prove ACQUISITION is gated, not just
// rendering.
jest.mock('pages/returns/useReturnsCorrelation', () => ({
  __esModule: true,
  useReturnsCorrelation: (enabled?: boolean) => mockUseReturnsCorrelation(enabled),
}));

jest.mock('pages/finances/useReturns', () => ({
  __esModule: true,
  useReturns: () => mockUseReturns(),
}));

jest.mock('components/ExportDrawer', () => ({
  ExportDrawer: () => null,
}));

// PlanGate is rendered transparently here ON PURPOSE. These tests must fail
// because the page still *depends* on it for the commercial decision, not
// because the gate happened to hide the section. Neutralising it means the
// only thing that can keep premium content off the screen is the canonical
// decision itself.
jest.mock('components/PlanGate', () => ({
  PlanGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// --- Direct-route (subtree) harness -----------------------------------------
// ModuleTabBar and the Items child are reduced to markers: the contract under
// test is the ROUTE SUBTREE gate, not their internals. CommercialGate itself is
// deliberately NOT mocked — the real gate must be exercised, resolving through
// the same mocked runtime/commercialContext boundary as everything else.
jest.mock('components/ModuleTabBar', () => ({
  ModuleTabBar: () => <div data-testid="module-tab-bar" />,
}));

jest.mock('pages/ft2-pages/ReturnsItemsPage', () => ({
  __esModule: true,
  default: () => <div data-testid="returns-items-page" />,
}));

// Captures that a DECISION-AWARE denial presentation was used, without
// freezing UpgradePrompt's internal markup.
const mockUpgradePrompt = jest.fn();
jest.mock('components/UpgradePrompt', () => ({
  UpgradePrompt: (props: Record<string, unknown>) => {
    mockUpgradePrompt(props);
    return <div data-testid="upgrade-prompt" />;
  },
}));

import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ReturnsOverviewPage from 'pages/ft2-pages/ReturnsOverviewPage';
import ReturnsSuppliersPage from 'pages/ft2-pages/ReturnsSuppliersPage';
import ReturnsFT2Page from 'pages/ft2-pages/ReturnsFT2Page';

/** Enter the Returns subtree by URL, exactly as a direct navigation would. */
function renderReturnsSubtreeAt(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route path="/returns/*" element={<ReturnsFT2Page />} />
      </Routes>
    </MemoryRouter>,
  );
}

const ALLOW = { allowed: true, reason: 'ALLOWED' as const };
const DENY_TIER_TOO_LOW = (requiredTier: string) => ({
  allowed: false,
  reason: 'TIER_TOO_LOW' as const,
  requiredTier,
});

const CORRELATION_ROWS = [
  {
    lasyncro_variant_id: 'v-1',
    variant_title: 'Blue Hoodie / M',
    sku: 'BH-M',
    receive_job_id: 'rj-1',
    batch_received_at: '2026-08-01T00:00:00.000Z',
    supplier_id: 7,
    supplier_name: 'Northwind Textiles',
    units_returned: 12,
    units_received: 40,
    return_rate_pct: 30,
    revenue_lost: 480,
  },
];

// Mechanical fixture shape ONLY — the real `ReturnsSummary` contract from
// pages/finances/useReturns.ts. The page body (and therefore the correlation
// section under test) is rendered behind `summary && summary.total_refunds > 0`
// (ReturnsOverviewPage.tsx:305), so an invented summary shape leaves the whole
// premium region unrendered and turns the "no premium data on screen"
// assertions into vacuous passes. These are ordinary non-empty Returns figures;
// no commercial meaning is carried here.
const RETURNS_SUMMARY = {
  summary: {
    total_refunds: 4,
    total_revenue_refunded: 900,
    total_margin_leakage: 310,
    avg_return_rate_pct: 12,
    total_units_returned: 9,
    total_units_restocked: 6,
    restock_rate_pct: 62,
    recovery_rate_pct: 75,
    recovery_jobs_complete: 3,
    recovery_jobs_total: 4,
  },
  by_variant: [],
  orphaned_jobs: [],
};

function setDecision(decision: ReturnType<typeof DENY_TIER_TOO_LOW> | typeof ALLOW) {
  mockDecide = () => decision;
  mockUseCommercialAccess.mockReturnValue({
    context: { tier: mockTier, modules: new Set<string>(), flags: new Set<string>() },
    isResolved: true,
    decide: (capabilityId: string) => mockDecide(capabilityId),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseReturns.mockReturnValue({
    data: RETURNS_SUMMARY,
    isLoading: false,
    isError: false,
  });
  mockUseReturnsCorrelation.mockReturnValue({
    data: { data: CORRELATION_ROWS },
    isLoading: false,
    isError: false,
  });
});

// ===========================================================================
// E — RETURNS OVERVIEW
// ===========================================================================

describe('RET-E1 — Core tenant, canonical returns.analysis DENY', () => {
  beforeEach(() => {
    // Legacy tier `growth` would satisfy the legacy PlanGate/tier check and
    // grant the premium section. The canonical decision must still win.
    mockTier = 'growth';
    setDecision(DENY_TIER_TOO_LOW('growth'));
  });

  it('GREEN CONTROL: base Returns Overview content stays useful and visible', () => {
    render(<ReturnsOverviewPage />);
    // Core content is NOT premium — a returns.analysis denial must never blank
    // the page a Core merchant paid for. Asserted on definite non-premium
    // summary stats rather than the ambiguous page word "Returns".
    expect(screen.getByText('Total refunds')).toBeInTheDocument();
    expect(screen.getByText('Restock rate')).toBeInTheDocument();
    expect(screen.getByText('Revenue refunded')).toBeInTheDocument();
  });

  it('EXPECTED RED: real correlation acquisition is DISABLED', () => {
    render(<ReturnsOverviewPage />);
    expect(mockUseReturnsCorrelation).toHaveBeenCalled();
    expect(mockUseReturnsCorrelation).toHaveBeenLastCalledWith(false);
  });

  it('EXPECTED RED: no premium supplier/batch correlation data reaches the screen', () => {
    render(<ReturnsOverviewPage />);
    expect(screen.queryByText('Northwind Textiles')).toBeNull();
    expect(screen.queryByText(/By Supplier/i)).toBeNull();
  });
});

describe('RET-E2 — Growth tenant, canonical returns.analysis ALLOW', () => {
  beforeEach(() => {
    // Legacy tier `core` would FAIL the legacy check. The canonical ALLOW must
    // still win.
    mockTier = 'core';
    setDecision(ALLOW);
  });

  it('EXPECTED RED: correlation acquisition is ENABLED', () => {
    render(<ReturnsOverviewPage />);
    expect(mockUseReturnsCorrelation).toHaveBeenLastCalledWith(true);
  });

  it('EXPECTED RED: the supplier/batch section renders from the provided data', () => {
    render(<ReturnsOverviewPage />);
    expect(screen.getByText(/By Supplier/i)).toBeInTheDocument();
    expect(screen.getByText('Northwind Textiles')).toBeInTheDocument();
  });
});

// ===========================================================================
// F — RETURNS SUPPLIERS
// ===========================================================================

describe('RET-F1 — Suppliers page, canonical returns.analysis DENY', () => {
  beforeEach(() => {
    mockTier = 'growth';
    setDecision(DENY_TIER_TOO_LOW('growth'));
  });

  it('EXPECTED RED: the page does not acquire /correlation', () => {
    render(<ReturnsSuppliersPage />);
    expect(mockUseReturnsCorrelation).toHaveBeenLastCalledWith(false);
  });

  it('EXPECTED RED: no real supplier analysis reaches the screen', () => {
    render(<ReturnsSuppliersPage />);
    expect(screen.queryByText('Northwind Textiles')).toBeNull();
  });
});

describe('RET-F2 — Suppliers page, canonical returns.analysis ALLOW', () => {
  beforeEach(() => {
    mockTier = 'core';
    setDecision(ALLOW);
  });

  it('EXPECTED RED: acquisition is enabled', () => {
    render(<ReturnsSuppliersPage />);
    expect(mockUseReturnsCorrelation).toHaveBeenLastCalledWith(true);
  });

  it('EXPECTED RED: supplied correlation data renders', () => {
    render(<ReturnsSuppliersPage />);
    // Non-unique by design: the page legitimately renders the supplier name in
    // BOTH the supplier scorecard and the suspect-batch table. The contract is
    // that allowed correlation data reaches the screen, never that the label
    // appears exactly once — so the count is deliberately not frozen.
    expect(screen.getAllByText('Northwind Textiles').length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// Contradiction protection — the canonical decision is the ONLY authority
// ===========================================================================

describe('RET-X1 — canonical decision beats legacy tier inference on both surfaces', () => {
  it('EXPECTED RED: Overview — legacy tier scale + canonical DENY resolves to denied', () => {
    mockTier = 'scale';
    setDecision(DENY_TIER_TOO_LOW('growth'));
    render(<ReturnsOverviewPage />);
    expect(mockUseReturnsCorrelation).toHaveBeenLastCalledWith(false);
    expect(screen.queryByText('Northwind Textiles')).toBeNull();
  });

  it('EXPECTED RED: Suppliers — legacy tier starter + canonical ALLOW resolves to allowed', () => {
    mockTier = 'starter';
    setDecision(ALLOW);
    render(<ReturnsSuppliersPage />);
    expect(mockUseReturnsCorrelation).toHaveBeenLastCalledWith(true);
    // Non-unique by design — see RET-F2.
    expect(screen.getAllByText('Northwind Textiles').length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// RET-R — DIRECT ROUTE PROTECTION of the Returns management subtree
//
// CommercialGate is the canonical ROUTE gate: a direct URL must resolve the
// SAME AccessDecision as the nav/tab click for the same destination
// (CommercialGate.tsx:5-7). ReturnsFT2Page currently mounts ModuleTabBar +
// Routes with NO gate, so entering /returns by URL bypasses the commercial
// decision entirely — nav presentation is not a security boundary.
//
// returns.core owns the management subtree (/returns, /returns/items,
// /returns/suppliers). Growth/Scale inherit it, so gating the subtree on
// returns.core stays compatible with the Suppliers page keeping its narrower
// returns.analysis gate internally.
// ===========================================================================

const DENY_RETURNS_CORE = {
  allowed: false,
  reason: 'TIER_TOO_LOW' as const,
  requiredTier: 'core',
};

describe('RET-R1 — direct route DENY on returns.core', () => {
  beforeEach(() => {
    mockTier = 'starter';
    setDecision(DENY_RETURNS_CORE);
  });

  it('EXPECTED RED: the Returns management child page is NOT mounted', () => {
    renderReturnsSubtreeAt('/returns');
    // Definite non-premium Core content — its absence proves the child never
    // mounted, not merely that a premium section was hidden.
    expect(screen.queryByText('Total refunds')).toBeNull();
    expect(screen.queryByText('Restock rate')).toBeNull();
  });

  it('EXPECTED RED: protected child data acquisition cannot begin from a direct URL', () => {
    renderReturnsSubtreeAt('/returns');
    expect(mockUseReturns).not.toHaveBeenCalled();
    expect(mockUseReturnsCorrelation).not.toHaveBeenCalled();
  });

  it('EXPECTED RED: a decision-aware locked presentation is rendered instead', () => {
    renderReturnsSubtreeAt('/returns');
    expect(screen.getByTestId('upgrade-prompt')).toBeInTheDocument();
    // Decision-AWARE: the denial carries the canonical decision, never a
    // hardcoded tier guess.
    expect(mockUpgradePrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: expect.objectContaining({
          allowed: false,
          reason: 'TIER_TOO_LOW',
          requiredTier: 'core',
        }),
      }),
    );
  });

  it('EXPECTED RED: the Items child is unreachable by direct URL too', () => {
    renderReturnsSubtreeAt('/returns/items');
    expect(screen.queryByTestId('returns-items-page')).toBeNull();
  });
});

describe('RET-R2 — direct route ALLOW on returns.core', () => {
  beforeEach(() => {
    mockTier = 'core';
    setDecision(ALLOW);
  });

  it('GREEN CONTROL: the subtree mounts its route content normally', () => {
    renderReturnsSubtreeAt('/returns');
    expect(screen.getByText('Total refunds')).toBeInTheDocument();
    expect(screen.queryByTestId('upgrade-prompt')).toBeNull();
  });

  it('GREEN CONTROL: the Items child mounts at its own path', () => {
    renderReturnsSubtreeAt('/returns/items');
    expect(screen.getByTestId('returns-items-page')).toBeInTheDocument();
  });
});

describe('RET-R3 — direct route contradiction protection', () => {
  it('EXPECTED RED: a legacy tier that would permit access does NOT override canonical DENY', () => {
    // Legacy tier `scale` would satisfy every historical Returns tier check.
    // The canonical returns.core denial must still win at the route boundary.
    mockTier = 'scale';
    setDecision(DENY_RETURNS_CORE);
    renderReturnsSubtreeAt('/returns');
    expect(screen.queryByText('Total refunds')).toBeNull();
    expect(mockUseReturns).not.toHaveBeenCalled();
    expect(screen.getByTestId('upgrade-prompt')).toBeInTheDocument();
  });
});
