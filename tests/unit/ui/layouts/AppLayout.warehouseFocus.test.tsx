// WAREHOUSE-FOCUS-SHELL-01A
//
// AppLayout derives execution-focus purely from the current URL
// (pathname + search params) via useLocation — no React context, no
// separate state to rehydrate on refresh. Focus is valid only on /wms
// routes, and only when warehouseFocus names a session whose matching
// identity param is also present:
//   warehouseFocus=stow    requires stowTaskId
//   warehouseFocus=receive requires receiveJobId
//
// This suite isolates AppLayout's own conditional render (topnav/sidenav
// container presence) from TopnavbarContent/SidenavContent internals,
// system-health/trial banners, and lifecycle gating — all stubbed so the
// only variable under test is the URL.

import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AppLayout from 'layouts/AppLayout';

jest.mock('api/axiosConfig', () => ({
  axiosInstance: { get: jest.fn().mockResolvedValue({ data: {} }) },
}));

jest.mock('lifecycle/ShopLifecycleContext', () => ({
  useShopLifecycle: () => ({ phase: 'FT2_READY' }),
}));

// Defaults reproduce the original fixed stubs; WAREHOUSE-SESSION-FOCUS-02A
// cases below override them per test to make commercial chrome and the
// system-health surface actually render.
const DEFAULT_ENTITLEMENTS = { trialEndsAt: null as string | null, tier: 'growth' };
let mockEntitlements = DEFAULT_ENTITLEMENTS;
let mockSystemHealth: unknown = null;

jest.mock('contexts/EntitlementsContext', () => ({
  useEntitlements: () => mockEntitlements,
}));

jest.mock('hooks/useSystemHealth', () => ({
  useSystemHealth: () => ({ data: mockSystemHealth }),
}));

jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({ logout: jest.fn() }),
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

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppLayout>
        <div data-testid="page-content" />
      </AppLayout>
    </MemoryRouter>
  );
}

describe('WAREHOUSE-FOCUS-SHELL-01A — AppLayout URL-backed execution focus', () => {
  it('ordinary /wms route: nav visible', () => {
    renderAt('/wms');

    expect(screen.getByTestId('topnav-stub')).toBeInTheDocument();
    expect(screen.getByTestId('sidenav-stub')).toBeInTheDocument();
  });

  it('Stow Brief URL (stowTaskId only, no warehouseFocus): nav visible', () => {
    renderAt('/wms?stowTaskId=task-a');

    expect(screen.getByTestId('topnav-stub')).toBeInTheDocument();
    expect(screen.getByTestId('sidenav-stub')).toBeInTheDocument();
  });

  it('focused Stow URL (warehouseFocus=stow + stowTaskId): topnav+sidenav absent', () => {
    renderAt('/wms?stowTaskId=task-a&stowStep=location&warehouseFocus=stow');

    expect(screen.queryByTestId('topnav-stub')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidenav-stub')).not.toBeInTheDocument();
    // Page content still renders — this is presentation-only, not a route guard.
    expect(screen.getByTestId('page-content')).toBeInTheDocument();
  });

  it('focused Stow URL without stowStep (item execution): topnav+sidenav absent', () => {
    renderAt('/wms?stowTaskId=task-a&warehouseFocus=stow');

    expect(screen.queryByTestId('topnav-stub')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidenav-stub')).not.toBeInTheDocument();
  });

  it('Receive Brief URL (receiveJobId only, no warehouseFocus): nav visible', () => {
    renderAt('/wms?receiveJobId=job-a');

    expect(screen.getByTestId('topnav-stub')).toBeInTheDocument();
    expect(screen.getByTestId('sidenav-stub')).toBeInTheDocument();
  });

  it('focused Receive URL (warehouseFocus=receive + receiveJobId): topnav+sidenav absent', () => {
    renderAt('/wms?receiveJobId=job-a&warehouseFocus=receive');

    expect(screen.queryByTestId('topnav-stub')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidenav-stub')).not.toBeInTheDocument();
  });

  it('warehouseFocus=stow with NO stowTaskId (stale/edited URL) does not gain focus', () => {
    renderAt('/wms?warehouseFocus=stow');

    expect(screen.getByTestId('topnav-stub')).toBeInTheDocument();
    expect(screen.getByTestId('sidenav-stub')).toBeInTheDocument();
  });

  it('warehouseFocus=receive with NO receiveJobId (stale/edited URL) does not gain focus', () => {
    renderAt('/wms?warehouseFocus=receive');

    expect(screen.getByTestId('topnav-stub')).toBeInTheDocument();
    expect(screen.getByTestId('sidenav-stub')).toBeInTheDocument();
  });

  it('warehouseFocus=stow with receiveJobId (mismatched identity) does not gain focus', () => {
    renderAt('/wms?receiveJobId=job-a&warehouseFocus=stow');

    expect(screen.getByTestId('topnav-stub')).toBeInTheDocument();
    expect(screen.getByTestId('sidenav-stub')).toBeInTheDocument();
  });

  it('focused params on a non-/wms route do not hide nav', () => {
    renderAt('/overview?stowTaskId=task-a&warehouseFocus=stow');

    expect(screen.getByTestId('topnav-stub')).toBeInTheDocument();
    expect(screen.getByTestId('sidenav-stub')).toBeInTheDocument();
  });

  it('explicit session exit (no params) restores normal shell', () => {
    renderAt('/wms');

    expect(screen.getByTestId('topnav-stub')).toBeInTheDocument();
    expect(screen.getByTestId('sidenav-stub')).toBeInTheDocument();
  });

  it('unfocused count URL (countTaskId only, no warehouseFocus — e.g. after fail-open): nav visible', () => {
    renderAt('/wms?countTaskId=count-a');

    expect(screen.getByTestId('topnav-stub')).toBeInTheDocument();
    expect(screen.getByTestId('sidenav-stub')).toBeInTheDocument();
  });

  it('focused Count URL (warehouseFocus=count + countTaskId): topnav+sidenav absent', () => {
    renderAt('/wms?countTaskId=count-a&warehouseFocus=count');

    expect(screen.queryByTestId('topnav-stub')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidenav-stub')).not.toBeInTheDocument();
    expect(screen.getByTestId('page-content')).toBeInTheDocument();
  });

  it('warehouseFocus=count with NO countTaskId does not gain focus', () => {
    renderAt('/wms?warehouseFocus=count');

    expect(screen.getByTestId('topnav-stub')).toBeInTheDocument();
    expect(screen.getByTestId('sidenav-stub')).toBeInTheDocument();
  });

});

// WAREHOUSE-SESSION-FOCUS-02A — Pick is execution-focused from the Pick Brief
// onward. Canonical focused Pick URL: /wms?batchId=<id>&warehouseFocus=pick.
// warehouseFocus=pick is valid only with a batchId. Focused Pick hides the
// topnav, sidenav and commercial chrome (TrialCountdownBanner,
// PostTrialInterstitial); the critical system-health surface is not part of
// that hiding contract. Each render is a fresh mount, i.e. the hard-reload
// path: focus is reconstructed from the URL alone.
describe('WAREHOUSE-SESSION-FOCUS-02A — AppLayout focused Pick session', () => {
  const FOCUSED_PICK_URL = '/wms?batchId=batch-a&warehouseFocus=pick';

  // Starter shop whose trial ended two days ago: both commercial surfaces
  // render on an ordinary /wms route (proven by the control case below).
  const POST_TRIAL_ENTITLEMENTS = {
    trialEndsAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    tier: 'starter',
  };

  afterEach(() => {
    mockEntitlements = DEFAULT_ENTITLEMENTS;
    mockSystemHealth = null;
  });

  it('hard reload of the canonical focused Pick URL: topnav+sidenav absent, page content preserved', () => {
    renderAt(FOCUSED_PICK_URL);

    expect(screen.queryByTestId('topnav-stub')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidenav-stub')).not.toBeInTheDocument();
    expect(screen.getByTestId('page-content')).toBeInTheDocument();
  });

  it('warehouseFocus=pick with NO batchId (stale/edited URL) does not gain focus', () => {
    renderAt('/wms?warehouseFocus=pick');

    expect(screen.getByTestId('topnav-stub')).toBeInTheDocument();
    expect(screen.getByTestId('sidenav-stub')).toBeInTheDocument();
  });

  it('warehouseFocus=pick with only a mismatched stowTaskId does not gain focus', () => {
    renderAt('/wms?stowTaskId=task-a&warehouseFocus=pick');

    expect(screen.getByTestId('topnav-stub')).toBeInTheDocument();
    expect(screen.getByTestId('sidenav-stub')).toBeInTheDocument();
  });

  it('control: ordinary /wms in post-trial state renders both commercial surfaces and system health', () => {
    mockEntitlements = POST_TRIAL_ENTITLEMENTS;
    mockSystemHealth = { status: 'degraded', snapshot: { lag_seconds: 120 } };

    renderAt('/wms');

    expect(screen.getByTestId('trial-banner-stub')).toBeInTheDocument();
    expect(screen.getByTestId('post-trial-stub')).toBeInTheDocument();
    expect(screen.getByTestId('system-health-banner-stub')).toBeInTheDocument();
  });

  it('focused Pick hides TrialCountdownBanner and PostTrialInterstitial while the system-health surface remains', () => {
    mockEntitlements = POST_TRIAL_ENTITLEMENTS;
    mockSystemHealth = { status: 'degraded', snapshot: { lag_seconds: 120 } };

    renderAt(FOCUSED_PICK_URL);

    expect(screen.getByTestId('system-health-banner-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('trial-banner-stub')).not.toBeInTheDocument();
    expect(screen.queryByTestId('post-trial-stub')).not.toBeInTheDocument();
  });

  it('stale warehouseFocus=pick with NO batchId keeps commercial chrome', () => {
    mockEntitlements = POST_TRIAL_ENTITLEMENTS;

    renderAt('/wms?warehouseFocus=pick');

    expect(screen.getByTestId('trial-banner-stub')).toBeInTheDocument();
    expect(screen.getByTestId('post-trial-stub')).toBeInTheDocument();
  });
});
