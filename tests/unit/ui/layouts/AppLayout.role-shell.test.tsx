// tests/unit/ui/layouts/AppLayout.role-shell.test.tsx
//
// INVENTORY INTELLIGENCE RED-D — ratified role-driven application shell.
//
//   OWNER / ADMIN — topnav + sidenav + routed content
//   OPERATOR      — NO topnav, NO sidenav; routed task content still renders
//
// The operator absence is role-driven, independent of the execution-focus
// URL params (warehouseFocus / stowTaskId / receiveJobId), which keep their
// own contract in AppLayout.warehouseFocus.test.tsx. The shell enforces the
// rule itself; navigation filtering (resolveNavigation) is not the mechanism.
//
// Harness mirrors AppLayout.warehouseFocus.test.tsx: topnav/sidenav contents,
// banners and lifecycle are stubbed so the only variables are role and URL.

import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AppLayout from 'layouts/AppLayout';

let mockRole: 'owner' | 'admin' | 'operator' = 'owner';

// RED-E: entitlement + health inputs are configurable so the commercial and
// health banner conditions can be exercised. Defaults keep every banner off,
// exactly as the original cases in this file were written.
type MockEntitlements = { trialEndsAt: string | null; tier: string };
let mockEntitlements: MockEntitlements = { trialEndsAt: null, tier: 'growth' };
let mockSystemHealthData: { status: string; snapshot?: { lag_seconds: number } } | null = null;

jest.mock('api/axiosConfig', () => ({
  axiosInstance: { get: jest.fn().mockResolvedValue({ data: {} }) },
}));

jest.mock('lifecycle/ShopLifecycleContext', () => ({
  useShopLifecycle: () => ({ phase: 'FT2_READY' }),
}));

jest.mock('contexts/EntitlementsContext', () => ({
  useEntitlements: () => mockEntitlements,
}));

jest.mock('hooks/useSystemHealth', () => ({
  useSystemHealth: () => ({ data: mockSystemHealthData }),
}));

jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({
    logout: jest.fn(),
    user: { id: 1, shop_id: 1, role: mockRole },
  }),
}));

jest.mock('hooks/useIdleTimeout', () => ({
  useIdleTimeout: jest.fn(),
}));

jest.mock('routes', () => ({ __esModule: true, default: [] }));

jest.mock('components/SystemHealthBanner', () => ({
  SystemHealthBanner: () => <div data-testid="system-health-banner-stub" />,
}));

jest.mock('components/TrialCountdownBanner', () => ({
  TrialCountdownBanner: () => <div data-testid="trial-banner-stub" />,
}));

// Present only when AppLayout asks it to show — mirrors the real show prop.
jest.mock('components/PostTrialInterstitial', () => ({
  PostTrialInterstitial: ({ show }: { show: boolean }) =>
    show ? <div data-testid="post-trial-stub" /> : null,
}));

jest.mock('layouts/AppLayout/SidenavContent', () => ({
  __esModule: true,
  default: () => <div data-testid="sidenav-stub" />,
}));

jest.mock('layouts/AppLayout/TopnavbarContent', () => ({
  __esModule: true,
  default: () => <div data-testid="topnav-stub" />,
}));

beforeEach(() => {
  mockEntitlements = { trialEndsAt: null, tier: 'growth' };
  mockSystemHealthData = null;
});

const DAY = 24 * 60 * 60 * 1000;
/** Existing trial-banner eligibility: an active trial end date. */
const ACTIVE_TRIAL: MockEntitlements = { trialEndsAt: new Date(Date.now() + 5 * DAY).toISOString(), tier: 'growth' };
/** Existing post-trial eligibility: starter, trial ended within the last 7 days. */
const POST_TRIAL: MockEntitlements = { trialEndsAt: new Date(Date.now() - 2 * DAY).toISOString(), tier: 'starter' };

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppLayout>
        <div data-testid="page-content" />
      </AppLayout>
    </MemoryRouter>
  );
}

describe('AppLayout role shell — OWNER / ADMIN keep the full application shell', () => {
  it.each(['owner', 'admin'] as const)('%s on /inventory: topnav, sidenav and routed content', (role) => {
    mockRole = role;
    renderAt('/inventory');

    expect(screen.getByTestId('topnav-stub')).toBeInTheDocument();
    expect(screen.getByTestId('sidenav-stub')).toBeInTheDocument();
    expect(screen.getByTestId('page-content')).toBeInTheDocument();
  });
});

describe('AppLayout role shell — OPERATOR gets no topnav and no sidenav', () => {
  beforeEach(() => {
    mockRole = 'operator';
  });

  it('operator on ordinary /wms (no execution focus): no topnav, no sidenav, task content present', () => {
    renderAt('/wms');

    expect(screen.queryByTestId('topnav-stub')).toBeNull();
    expect(screen.queryByTestId('sidenav-stub')).toBeNull();
    expect(screen.getByTestId('page-content')).toBeInTheDocument();
  });

  it('operator on a /wms sub-route: still no topnav or sidenav', () => {
    renderAt('/wms/pick');

    expect(screen.queryByTestId('topnav-stub')).toBeNull();
    expect(screen.queryByTestId('sidenav-stub')).toBeNull();
    expect(screen.getByTestId('page-content')).toBeInTheDocument();
  });

  it('operator in a focused execution session: still no topnav or sidenav', () => {
    renderAt('/wms?warehouseFocus=stow&stowTaskId=task-1');

    expect(screen.queryByTestId('topnav-stub')).toBeNull();
    expect(screen.queryByTestId('sidenav-stub')).toBeNull();
    expect(screen.getByTestId('page-content')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// RED-E — operator commercial chrome vs execution-relevant health.
// Trial countdown and post-trial interstitial are owner/admin commercial
// chrome; operators cannot act on billing (ProtectedRoute keeps them on /wms).
// An unhealthy system-health banner stays visible to operators.
// ---------------------------------------------------------------------------

describe('AppLayout role shell — commercial chrome stays with OWNER / ADMIN', () => {
  it.each(['owner', 'admin'] as const)('%s: trial countdown banner remains eligible during an active trial', (role) => {
    mockRole = role;
    mockEntitlements = ACTIVE_TRIAL;
    renderAt('/inventory');

    expect(screen.getByTestId('trial-banner-stub')).toBeInTheDocument();
  });

  it.each(['owner', 'admin'] as const)('%s: post-trial interstitial remains eligible after a recent trial end', (role) => {
    mockRole = role;
    mockEntitlements = POST_TRIAL;
    renderAt('/inventory');

    expect(screen.getByTestId('post-trial-stub')).toBeInTheDocument();
  });
});

describe('AppLayout role shell — OPERATOR loses commercial chrome, keeps health', () => {
  beforeEach(() => {
    mockRole = 'operator';
  });

  it.each(['/wms', '/wms?warehouseFocus=stow&stowTaskId=task-1'])(
    'operator on %s: no trial countdown banner during an active trial',
    (path) => {
      mockEntitlements = ACTIVE_TRIAL;
      renderAt(path);

      expect(screen.queryByTestId('trial-banner-stub')).toBeNull();
      expect(screen.getByTestId('page-content')).toBeInTheDocument();
    }
  );

  it('operator on /wms: no post-trial interstitial after a recent trial end', () => {
    mockEntitlements = POST_TRIAL;
    renderAt('/wms');

    expect(screen.queryByTestId('post-trial-stub')).toBeNull();
    expect(screen.getByTestId('page-content')).toBeInTheDocument();
  });

  it('operator on /wms: an unhealthy system-health banner stays visible', () => {
    mockSystemHealthData = { status: 'critical', snapshot: { lag_seconds: 600 } };
    renderAt('/wms');

    expect(screen.getByTestId('system-health-banner-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('topnav-stub')).toBeNull();
    expect(screen.queryByTestId('sidenav-stub')).toBeNull();
    expect(screen.getByTestId('page-content')).toBeInTheDocument();
  });
});
