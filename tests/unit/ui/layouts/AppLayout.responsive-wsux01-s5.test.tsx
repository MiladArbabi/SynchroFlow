// tests/unit/ui/layouts/AppLayout.responsive-wsux01-s5.test.tsx
//
// WS-UX-01 S5-A — responsive global shell (contract WS-UX-01-S5-RESPONSIVE-v1.1).
//
//   < 768px  — the sidenav reserves no width and opens as a modal overlay from
//              a 44px header trigger; Escape / backdrop / close button / any
//              navigation dismiss it; focus is contained and returns to the
//              trigger. The desktop EXPANDED/COMPACT preference is never
//              written by the mobile shell or by resizing.
//   >= 768px — the existing desktop sidenav and preference are unchanged.
//
// FT2 admission, the operator chrome-free shell and valid warehouseFocus keep
// suppressing navigation exactly as before (AppLayout.role-shell and
// AppLayout.warehouseFocus remain the authorities for those contracts).
//
// Harness mirrors AppLayout.role-shell.test.tsx. The topnav stub forwards the
// real mobileNav prop so the AppLayout wiring is exercised; the real
// TopnavbarContent trigger is covered separately at the end of the file.

import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import AppLayout from 'layouts/AppLayout';
import TopnavbarContent from 'layouts/AppLayout/TopnavbarContent';

let mockRole: 'owner' | 'admin' | 'operator' = 'owner';
let mockPhase = 'FT2_READY';

jest.mock('api/axiosConfig', () => ({
  axiosInstance: { get: jest.fn().mockResolvedValue({ data: {} }), post: jest.fn().mockResolvedValue({ data: {} }) },
}));
jest.mock('lifecycle/ShopLifecycleContext', () => ({ useShopLifecycle: () => ({ phase: mockPhase }) }));
jest.mock('contexts/EntitlementsContext', () => ({ useEntitlements: () => ({ trialEndsAt: null, tier: 'growth' }) }));
jest.mock('hooks/useSystemHealth', () => ({ useSystemHealth: () => ({ data: null }) }));
jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({ logout: jest.fn(), user: { id: 1, shop_id: 1, role: mockRole, first_name: 'Olive', email: 'o@example.test' } }),
}));
jest.mock('hooks/useIdleTimeout', () => ({ useIdleTimeout: jest.fn() }));
jest.mock('routes', () => ({ __esModule: true, default: [] }));
jest.mock('components/SystemHealthBanner', () => ({ SystemHealthBanner: () => null }));
jest.mock('components/PostTrialInterstitial', () => ({ PostTrialInterstitial: () => null }));

// Sidenav stub: records the state it was given and offers a navigation link,
// so preference handling and close-after-navigation can be asserted.
const mockSidenavStates: string[] = [];
jest.mock('layouts/AppLayout/SidenavContent', () => ({
  __esModule: true,
  default: function SidenavStub({ sidenavState }: { sidenavState: string }) {
    mockSidenavStates.push(sidenavState);
    const navigate = jest.requireActual('react-router-dom').useNavigate();
    return (
      <div data-testid="sidenav-stub" data-state={sidenavState}>
        <button type="button" onClick={() => navigate('/suppliers-portal')}>Open POs</button>
      </div>
    );
  },
}));

// Topnav stub: renders the mobile trigger only when AppLayout supplies it,
// using the same props the real component reads.
jest.mock('layouts/AppLayout/TopnavbarContent', () => {
  const actual = jest.requireActual('layouts/AppLayout/TopnavbarContent');
  const mockReact = jest.requireActual('react');
  return {
    __esModule: true,
    default: (props: { mobileNav?: { open: boolean; controlsId: string; onOpen: () => void }; onToggleSidenav: () => void }) =>
      (globalThis as { __useRealTopnav?: boolean }).__useRealTopnav
        ? mockReact.createElement(actual.default, props)
        : (
          <div data-testid="topnav-stub">
            {props.mobileNav && (
              <button
                type="button"
                aria-label="Open navigation"
                aria-controls={props.mobileNav.controlsId}
                aria-expanded={props.mobileNav.open}
                onClick={props.mobileNav.onOpen}
              />
            )}
            <button type="button" onClick={props.onToggleSidenav}>toggle-desktop</button>
          </div>
        ),
  };
});

// Real-topnav dependencies (only used by the last describe block).
jest.mock('components/OpsConsole', () => ({ OpsConsoleButton: () => <button type="button" aria-label="Ops Console — 0 open" /> }));
jest.mock('pages/alerts/useAlerts', () => ({ useAlerts: () => ({ data: { data: [] } }) }));
jest.mock('hooks/useBillingUsage', () => ({ useBillingUsage: () => ({ data: undefined }) }));
jest.mock('components/ShopifyConnectionBadge/ShopifyConnectionBadge', () => ({ ShopifyConnectionBadge: () => null }));
jest.mock('runtime/registerNav', () => ({ getBreadcrumbLabel: () => ({ label: 'Open POs', parentLabel: 'Purchasing' }) }));

// ─── matchMedia: a controllable viewport for useMediaQuery ───────────────────
const MOBILE_QUERY = '(max-width: 767.98px)';
let viewportWidth = 1440;
const listeners = new Set<() => void>();
function setViewport(width: number) {
  viewportWidth = width;
  act(() => { listeners.forEach((l) => l()); });
}
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => {
      const evaluate = () => (query.includes('max-width: 767.98px') ? viewportWidth < 768 : false);
      const mql = {
        get matches() { return evaluate(); },
        media: query,
        onchange: null,
        addEventListener: (_: string, l: () => void) => listeners.add(l),
        removeEventListener: (_: string, l: () => void) => listeners.delete(l),
        addListener: (l: () => void) => listeners.add(l),
        removeListener: (l: () => void) => listeners.delete(l),
        dispatchEvent: () => false,
      };
      return mql;
    },
  });
});

beforeEach(() => {
  mockRole = 'owner';
  mockPhase = 'FT2_READY';
  mockSidenavStates.length = 0;
  listeners.clear();
  localStorage.clear();
  (globalThis as { __useRealTopnav?: boolean }).__useRealTopnav = false;
});

function LocationProbe() {
  const navigate = useNavigate();
  return <button type="button" data-testid="external-nav" onClick={() => navigate('/inventory')} />;
}

function renderAt(path: string, width: number) {
  viewportWidth = width;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppLayout>
        <div data-testid="page-content"><LocationProbe /></div>
      </AppLayout>
    </MemoryRouter>,
  );
}

const trigger = () => screen.getByRole('button', { name: 'Open navigation' });
const drawer = () => screen.queryByRole('dialog', { name: 'Main navigation' });

describe('S5-A mobile shell (< 768px) — owner/admin in FT2', () => {
  it.each(['owner', 'admin'] as const)('%s: no permanent sidenav, content present, drawer closed on entry', (role) => {
    mockRole = role;
    renderAt('/suppliers-portal', 390);
    expect(screen.queryByTestId('sidenav-stub')).toBeNull();
    expect(drawer()).toBeNull();
    expect(screen.getByTestId('page-content')).toBeInTheDocument();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(trigger()).toHaveAttribute('aria-controls', 'mobile-navigation');
  });

  it('the trigger opens a labelled modal overlay with the full navigation and a 44px close control', async () => {
    renderAt('/suppliers-portal', 320);
    fireEvent.click(trigger());
    const nav = await screen.findByRole('dialog', { name: 'Main navigation' });
    expect(nav).toHaveAttribute('id', 'mobile-navigation');
    expect(nav).toHaveAttribute('aria-modal', 'true');
    expect(within(nav).getByTestId('sidenav-stub')).toHaveAttribute('data-state', 'EXPANDED');
    expect(within(nav).getByRole('button', { name: 'Close navigation' })).toBeInTheDocument();
    // The header is behind the modal (aria-hidden), so query hidden elements.
    expect(screen.getByRole('button', { name: 'Open navigation', hidden: true })).toHaveAttribute('aria-expanded', 'true');
    // Exactly one navigation instance is mounted.
    expect(screen.getAllByTestId('sidenav-stub')).toHaveLength(1);
  });

  it.each([
    ['close button', () => fireEvent.click(screen.getByRole('button', { name: 'Close navigation' }))],
    ['Escape', () => fireEvent.keyDown(screen.getByRole('dialog', { name: 'Main navigation' }), { key: 'Escape' })],
    ['backdrop', () => fireEvent.click(document.querySelector('.MuiBackdrop-root') as Element)],
  ])('dismisses with the %s and returns focus to the trigger', async (_label, dismiss) => {
    renderAt('/suppliers-portal', 390);
    trigger().focus();
    fireEvent.click(trigger());
    await screen.findByRole('dialog', { name: 'Main navigation' });
    dismiss();
    await waitFor(() => expect(drawer()).toBeNull());
    await waitFor(() => expect(trigger()).toHaveFocus());
  });

  it('focus moves into the open drawer and the page behind it is hidden from assistive tech', async () => {
    renderAt('/suppliers-portal', 390);
    fireEvent.click(trigger());
    const nav = await screen.findByRole('dialog', { name: 'Main navigation' });
    await waitFor(() => expect(nav.contains(document.activeElement)).toBe(true));
    // MUI Modal marks the app root aria-hidden while open (inert background).
    const root = screen.getByTestId('page-content').closest('[aria-hidden="true"]');
    expect(root).not.toBeNull();
  });

  it('closes after navigating from inside the drawer', async () => {
    renderAt('/inventory', 390);
    fireEvent.click(trigger());
    const nav = await screen.findByRole('dialog', { name: 'Main navigation' });
    fireEvent.click(within(nav).getByRole('button', { name: 'Open POs' }));
    await waitFor(() => expect(drawer()).toBeNull());
  });

  it('never writes the desktop preference', async () => {
    localStorage.setItem('sidenavState', 'COMPACT');
    renderAt('/suppliers-portal', 390);
    fireEvent.click(trigger());
    await screen.findByRole('dialog', { name: 'Main navigation' });
    fireEvent.click(screen.getByRole('button', { name: 'Close navigation' }));
    await waitFor(() => expect(drawer()).toBeNull());
    expect(localStorage.getItem('sidenavState')).toBe('COMPACT');
  });
});

describe('S5-A desktop shell (>= 768px) — unchanged', () => {
  it.each([768, 1024, 1440])('%ipx: permanent sidenav with the saved preference, no mobile trigger', (width) => {
    localStorage.setItem('sidenavState', 'COMPACT');
    renderAt('/suppliers-portal', width);
    expect(screen.getByTestId('sidenav-stub')).toHaveAttribute('data-state', 'COMPACT');
    expect(screen.queryByRole('button', { name: 'Open navigation' })).toBeNull();
    expect(drawer()).toBeNull();
  });

  it('the desktop toggle still flips and persists EXPANDED/COMPACT', () => {
    localStorage.setItem('sidenavState', 'EXPANDED');
    renderAt('/suppliers-portal', 1440);
    fireEvent.click(screen.getByRole('button', { name: 'toggle-desktop' }));
    expect(screen.getByTestId('sidenav-stub')).toHaveAttribute('data-state', 'COMPACT');
    expect(localStorage.getItem('sidenavState')).toBe('COMPACT');
  });
});

describe('S5-A resizing across 768px', () => {
  it('desktop → mobile → desktop keeps the preference and never leaves the drawer open', async () => {
    localStorage.setItem('sidenavState', 'COMPACT');
    renderAt('/suppliers-portal', 1440);
    expect(screen.getByTestId('sidenav-stub')).toHaveAttribute('data-state', 'COMPACT');

    setViewport(390);
    expect(screen.queryByTestId('sidenav-stub')).toBeNull();
    fireEvent.click(trigger());
    await screen.findByRole('dialog', { name: 'Main navigation' });

    setViewport(1024);
    await waitFor(() => expect(drawer()).toBeNull());
    expect(screen.getByTestId('sidenav-stub')).toHaveAttribute('data-state', 'COMPACT');
    expect(localStorage.getItem('sidenavState')).toBe('COMPACT');

    setViewport(390);
    expect(drawer()).toBeNull();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('S5-A lifecycle, role and focus invariants on mobile', () => {
  it('outside FT2 there is no sidenav and no mobile trigger', () => {
    mockPhase = 'FT1_READY';
    renderAt('/overview', 390);
    expect(screen.queryByRole('button', { name: 'Open navigation' })).toBeNull();
    expect(screen.queryByTestId('sidenav-stub')).toBeNull();
  });

  it('operators stay chrome-free and keep their session control', () => {
    mockRole = 'operator';
    renderAt('/wms', 390);
    expect(screen.queryByTestId('topnav-stub')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open navigation' })).toBeNull();
    expect(screen.getByTestId('operator-session-control')).toBeInTheDocument();
  });

  it('a valid warehouseFocus session suppresses topnav and the mobile trigger', () => {
    renderAt('/wms?warehouseFocus=stow&stowTaskId=task-1', 390);
    expect(screen.queryByTestId('topnav-stub')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open navigation' })).toBeNull();
  });

  it('an incomplete warehouseFocus URL does not suppress the shell', () => {
    renderAt('/wms?warehouseFocus=stow', 390);
    expect(screen.getByTestId('topnav-stub')).toBeInTheDocument();
    expect(trigger()).toBeInTheDocument();
  });
});

describe('S5-A real TopnavbarContent trigger', () => {
  function renderTopnav(mobileNav?: { open: boolean; controlsId: string; onOpen: () => void }) {
    (globalThis as { __useRealTopnav?: boolean }).__useRealTopnav = true;
    return render(
      <MemoryRouter initialEntries={['/suppliers-portal']}>
        <TopnavbarContent isEditing={false} onEditToggle={() => {}} onAddWidget={() => {}} onToggleSidenav={() => {}} mobileNav={mobileNav} />
      </MemoryRouter>,
    );
  }

  it('renders an accessible menu trigger wired to the drawer, and the Ops Console stays available', () => {
    const onOpen = jest.fn();
    renderTopnav({ open: false, controlsId: 'mobile-navigation', onOpen });
    const btn = screen.getByRole('button', { name: 'Open navigation' });
    expect(btn).toHaveAttribute('aria-haspopup', 'dialog');
    expect(btn).toHaveAttribute('aria-controls', 'mobile-navigation');
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Ops Console/ })).toBeInTheDocument();
  });

  // SF-WSUX01-S5A-HEADER-CORRECT-004 — the breadcrumb is one truncating line
  // and Home stays a named, keyboard-reachable link beside the menu trigger.
  // (Pixel reachability at 320/390 is proven by the browser hit-test.)
  it('keeps Home as an accessible, keyboard-reachable link and truncates breadcrumb labels', () => {
    renderTopnav({ open: false, controlsId: 'mobile-navigation', onOpen: jest.fn() });
    const crumbs = screen.getByRole('navigation', { name: 'breadcrumb' });
    const home = within(crumbs).getByRole('link', { name: 'Home' });
    expect(home).toHaveAttribute('href', '/');
    home.focus();
    expect(home).toHaveFocus();
    for (const label of ['Purchasing', 'Open POs']) {
      expect(within(crumbs).getByText(label)).toHaveClass('MuiTypography-noWrap');
    }
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ops Console/ })).toBeInTheDocument();
  });

  it('desktop (no mobileNav prop) renders no trigger', () => {
    renderTopnav(undefined);
    expect(screen.queryByRole('button', { name: 'Open navigation' })).toBeNull();
    expect(screen.getByRole('button', { name: /Ops Console/ })).toBeInTheDocument();
  });
});

void MOBILE_QUERY;
