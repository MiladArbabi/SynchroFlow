// tests/unit/ui/commercial-access/overview-live-map-commercial-access.test.tsx
//
// COMMERCIAL-ACCESS-ARCH-01 — Slice P0-A3-2 — TEST STRATEGY / RED
// =================================================================
// B (behavioral, jsdom) counterpart to
// tests/contract/overview-live-map-commercial-access.contract.test.ts.
//
// Proves AUTHORITY, not a claim about the current canonical policy: every
// scenario below constructs a deliberate disagreement between the legacy
// tier and a mocked canonical overview.live_map AccessDecision, then asserts
// the canonical decision must win. This is never a claim that any given tier
// should actually be granted/denied overview.live_map — it is a parity/
// authority proof only, mirroring
// tests/unit/ui/commercial-access/export-commercial-access.test.tsx.
//
// Mock harness adapted from
// tests/unit/ui/overview/OverviewFT2Page.refresh-boundary.test.tsx rather
// than rebuilt from scratch. Decision source mocked at its public boundary
// (runtime/commercialContext's useCommercialAccess) rather than
// hand-reimplementing commercial policy.

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

const mockNavigate = jest.fn();
const mockUseMorningBriefSnapshot = jest.fn();
const mockRefreshMorningBrief = jest.fn();
const mockFloorPlanningRefetch = jest.fn();
const mockUseFloorPlanning = jest.fn();
const mockUseWmsLiveActivity = jest.fn();
const mockUseOccupancy = jest.fn();
const mockUseIdleAlerts = jest.fn();
const mockUseProblemCenter = jest.fn();
const mockEmit = jest.fn();

// Exposes the props the production page cannot be observed through
// otherwise: pulse/morningBrief continuity and the supplied mapContent.
const mockOverviewModuleFT2 = jest.fn((props: Record<string, unknown>) => (
  <div>
    <div data-testid="pulse-prop">{props.pulse ? 'present' : 'missing'}</div>
    <div data-testid="morning-brief-prop">{props.morningBrief ? 'present' : 'missing'}</div>
    <div data-testid="map-content">{(props.mapContent as React.ReactNode) ?? null}</div>
  </div>
));

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

jest.mock('@lasyncro/overview', () => ({
  OverviewModuleFT2: (props: Record<string, unknown>) => mockOverviewModuleFT2(props),
}), { virtual: true });

jest.mock('@lasyncro/shared/ui', () => ({
  IsometricCanvas: ({ zones }: { zones: Array<{ location_code: string }> }) => (
    <div data-testid={zones[0]?.location_code === 'PREVIEW' ? 'synthetic-map' : 'live-map'} />
  ),
}));

jest.mock('analytics/useUiEvents', () => ({
  useUiEvents: () => ({ emit: (...args: unknown[]) => mockEmit(...args) }),
}), { virtual: true });

jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { role: 'owner', first_name: 'Milad' },
    isLoading: false,
  }),
}));

// Legacy tier source — set per test, deliberately disagreeing with the
// mocked canonical decision below.
let mockTier: 'starter' | 'core' | 'growth' | 'scale' = 'growth';
jest.mock('contexts/EntitlementsContext', () => ({
  useEntitlements: () => ({
    displayCurrency: 'USD',
    tier: mockTier,
    hasResolved: true,
  }),
}));

// Controlled canonical decision — set per test. Mocked at the shared
// adapter's public boundary (useCommercialAccess), never re-deriving tier/
// module/feature policy locally.
let mockDecide: (capabilityId: string) => { allowed: boolean; reason: string; requiredTier?: string };
jest.mock('runtime/commercialContext', () => ({
  __esModule: true,
  useCommercialAccess: () => ({
    context: { tier: mockTier, modules: new Set<string>(), flags: new Set<string>() },
    isResolved: true,
    decide: (capabilityId: string) => mockDecide(capabilityId),
  }),
}));

jest.mock('pages/overview/useOverviewFt2Adapter', () => ({
  mapOverviewFt2Props: () => ({
    trust: {
      dataFreshness: 'fresh',
      syncCoverage: 'complete',
      lastSyncAt: '2026-09-05T00:00:00.000Z',
    },
    pulse: {
      revenueToday: 1000,
      revenueDeltaVsYesterday: 0,
      collectedRevenue: 900,
      atRiskRevenue: 0,
      blockedRevenue: 0,
      topBlockingType: null,
    },
  }),
}));

jest.mock('pages/overview/useOverviewModulesFt2Snapshot', () => ({
  useOverviewModulesFt2Snapshot: () => ({
    isPending: false,
    isError: false,
    data: {},
  }),
}));

jest.mock('pages/trust/useTrustFt2Snapshot', () => ({
  useTrustFt2Snapshot: () => ({ data: null }),
}));

jest.mock('pages/overview/useMorningBriefSnapshot', () => ({
  useMorningBriefSnapshot: (...args: unknown[]) => mockUseMorningBriefSnapshot(...args),
}));

jest.mock('pages/overview/ProfileCompletionBanner', () => ({
  ProfileCompletionBanner: () => null,
}));

// hasPlacedFloor === true (positioned zone) in every scenario below, so the
// map-slot branch under test is purely the canonical-decision gate, never the
// "no floor configured" empty state.
//
// P0-A3-2 CORRECTION: the enabled argument is captured at this boundary so the
// test can prove floor-geometry ACQUISITION is gated by the same canonical
// decision — not merely that the rendered map slot is hidden.
jest.mock('pages/floor-planning/useFloorPlanning', () => ({
  useFloorPlanning: (enabled?: boolean) => mockUseFloorPlanning(enabled),
}));

jest.mock('pages/floor-planning/useWarehouseGrid', () => ({
  useWarehouseGridOccupancy: (enabled: boolean) => { mockUseOccupancy(enabled); return ({
    data: { occupancy: {} },
    isLoading: false,
    isError: false,
  }); },
}));

jest.mock('pages/wms/useOrderPool', () => ({
  useOrderPool: () => ({
    data: {
      eligible_order_count: 0,
      summary: { blocked_count: 0 },
    },
    isPending: false,
    isError: false,
  }),
}));

jest.mock('pages/wms/useWmsLiveActivity', () => ({
  useWmsLiveActivity: (enabled: boolean) => mockUseWmsLiveActivity(enabled),
}));

jest.mock('../../../../apps/frontend/src/hooks/useIdleAlerts', () => ({
  useIdleAlerts: (enabled: boolean) => { mockUseIdleAlerts(enabled); return ({
    alerts: [],
    isLoading: false,
    isError: false,
  }); },
}));

jest.mock('pages/problem-center/useProblemCenter', () => ({
  useProblemCenter: (enabled: boolean) => { mockUseProblemCenter(enabled); return ({
    data: { tasks: [] },
    isLoading: false,
    isError: false,
  }); },
}));

import OverviewPageFT2 from 'pages/ft2-pages/OverviewFT2Page';

const ALLOW = { allowed: true, reason: 'ALLOWED' as const };
const DENY_TIER_TOO_LOW = (requiredTier: string) => ({
  allowed: false, reason: 'TIER_TOO_LOW' as const, requiredTier,
});

const initialBrief = {
  signals: [
    {
      id: 'revenue:shop-1:at_risk',
      priority: 2,
      title: '10 orders blocked',
      detail: 'Resolve each blocker.',
      module: 'orders',
      deepLink: '/orders/flow',
      revenueImpact: 13198.9,
    },
  ],
  hasUrgentIssues: true,
  generatedAt: '2026-09-05T00:00:00.000Z',
  trustWarning: false,
  fromCache: false,
  greeting: 'Good evening.',
  summaryLine: '1 decision pending. Review the issue below.',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseFloorPlanning.mockReturnValue({
    data: {
      zones: [
        {
          location_code: 'A-1',
          type: 'bin',
          active: true,
          position_x: 1,
          position_y: 1,
          zone_type: 'pick',
        },
      ],
    },
    isLoading: false,
    isError: false,
    refetch: mockFloorPlanningRefetch,
  });
  mockUseMorningBriefSnapshot.mockReturnValue({
    isPending: false,
    isError: false,
    isRefreshingBrief: false,
    data: initialBrief,
    refreshMorningBrief: mockRefreshMorningBrief,
  });
  mockUseWmsLiveActivity.mockReturnValue({
    data: {
      pickerPositions: [],
      activeBatches: [],
      stowPressure: { by_location: [] },
      receiveAtDock: [],
      awaitingPackUnits: 0,
      shippedToday: 0,
      packedNotShipped: 0,
      staleThresholdMinutes: 15,
    },
    isLoading: false,
    isError: false,
  });
});

// ===========================================================================
// OVLM-A — legacy tier Growth/Scale + canonical DENY: denied path must win
// ===========================================================================
describe('OVLM-A — canonical overview.live_map DENY wins over a permissive legacy tier', () => {
  it('legacy tier growth (would satisfy the legacy hasMapTier check), canonical DENY — teaser wins, live map absent, polling disabled', () => {
    mockTier = 'growth';
    mockDecide = () => DENY_TIER_TOO_LOW('growth');
    render(<OverviewPageFT2 />);

    // Scoped to the map-content slot: the teaser itself renders its own
    // decorative preview IsometricCanvas (also mocked to this testid), so an
    // unscoped query would be ambiguous between the two.
    expect(screen.getByTestId('map-content').querySelector('[data-testid="live-map"]')).toBeNull();
    expect(screen.getByTestId('map-content')).toContainElement(screen.getByText('Overview live map'));
    expect(screen.getByTestId('synthetic-map')).toBeInTheDocument();
    expect(mockUseWmsLiveActivity).toHaveBeenLastCalledWith(false);
    // P0-A3-2 CORRECTION: a denial must also stop ACQUIRING floor geometry,
    // not merely stop rendering it.
    expect(mockUseFloorPlanning).toHaveBeenLastCalledWith(false);
    expect(mockUseOccupancy).toHaveBeenLastCalledWith(false);
    expect(mockUseIdleAlerts).toHaveBeenLastCalledWith(false);
    expect(mockUseProblemCenter).toHaveBeenLastCalledWith(false);
  });

  it('legacy tier scale, canonical DENY — same authority requirement', () => {
    mockTier = 'scale';
    mockDecide = () => DENY_TIER_TOO_LOW('growth');
    render(<OverviewPageFT2 />);

    // Scoped to the map-content slot: the teaser itself renders its own
    // decorative preview IsometricCanvas (also mocked to this testid), so an
    // unscoped query would be ambiguous between the two.
    expect(screen.getByTestId('map-content').querySelector('[data-testid="live-map"]')).toBeNull();
    expect(screen.getByTestId('map-content')).toContainElement(screen.getByText('Overview live map'));
    expect(screen.getByTestId('synthetic-map')).toBeInTheDocument();
    expect(mockUseWmsLiveActivity).toHaveBeenLastCalledWith(false);
    expect(mockUseFloorPlanning).toHaveBeenLastCalledWith(false);
    expect(mockUseOccupancy).toHaveBeenLastCalledWith(false);
    expect(mockUseIdleAlerts).toHaveBeenLastCalledWith(false);
    expect(mockUseProblemCenter).toHaveBeenLastCalledWith(false);
  });

  it('GREEN CONTROL: Pulse and Decisions continuity survive a commercial denial', () => {
    mockTier = 'growth';
    mockDecide = () => DENY_TIER_TOO_LOW('growth');
    render(<OverviewPageFT2 />);

    expect(screen.getByTestId('pulse-prop')).toHaveTextContent('present');
    expect(screen.getByTestId('morning-brief-prop')).toHaveTextContent('present');
  });
});

// ===========================================================================
// OVLM-B — legacy tier Starter/Core + canonical ALLOW: allowed path must win
// ===========================================================================
describe('OVLM-B — canonical overview.live_map ALLOW wins over a restrictive legacy tier', () => {
  it('legacy tier starter (would fail the legacy hasMapTier check), canonical ALLOW — live map wins, teaser absent, polling enabled', () => {
    mockTier = 'starter';
    mockDecide = () => ALLOW;
    render(<OverviewPageFT2 />);

    expect(screen.getByTestId('live-map')).not.toBeNull();
    expect(screen.queryByText('Overview live map')).toBeNull();
    expect(screen.queryByTestId('synthetic-map')).toBeNull();
    expect(mockUseWmsLiveActivity).toHaveBeenLastCalledWith(true);
    // P0-A3-2 CORRECTION: an allowance must actually acquire floor geometry.
    expect(mockUseFloorPlanning).toHaveBeenLastCalledWith(true);
    expect(mockUseOccupancy).toHaveBeenLastCalledWith(true);
    expect(mockUseIdleAlerts).toHaveBeenLastCalledWith(true);
    expect(mockUseProblemCenter).toHaveBeenLastCalledWith(true);
  });

  it('legacy tier core, canonical ALLOW — same authority requirement', () => {
    mockTier = 'core';
    mockDecide = () => ALLOW;
    render(<OverviewPageFT2 />);

    expect(screen.getByTestId('live-map')).not.toBeNull();
    expect(screen.queryByText('Overview live map')).toBeNull();
    expect(screen.queryByTestId('synthetic-map')).toBeNull();
    expect(mockUseWmsLiveActivity).toHaveBeenLastCalledWith(true);
    expect(mockUseFloorPlanning).toHaveBeenLastCalledWith(true);
    expect(mockUseOccupancy).toHaveBeenLastCalledWith(true);
    expect(mockUseIdleAlerts).toHaveBeenLastCalledWith(true);
    expect(mockUseProblemCenter).toHaveBeenLastCalledWith(true);
  });
});

// ===========================================================================
// OVLM-C — denial metadata: teaser must consume AccessDecision.requiredTier,
// never a hardcoded Growth assumption
// ===========================================================================
describe('OVLM-C — teaser required-tier metadata derives from AccessDecision, not a hardcoded value', () => {
  it('a deliberate non-growth requiredTier from the decision reaches the teaser and its CTA opens billing', () => {
    mockTier = 'starter';
    // Deliberately NOT 'growth' — proves the teaser must read this value
    // from the decision rather than assuming Growth unconditionally.
    mockDecide = () => DENY_TIER_TOO_LOW('scale');
    render(<OverviewPageFT2 />);

    expect(screen.getByText('Available on Scale')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Upgrade/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/settings/billing');
  });
});
