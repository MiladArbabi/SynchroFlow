// tests/unit/ui/layouts/SidenavContent.ov-v1-theme-ownership.test.tsx
//
// OV-V1-0 — RED CONTRACT: global shell ownership (Sidenav side).
//
// Ratified shell contract:
//   Sidenav owns domain navigation plus, at the bottom, a Dark/Light mode
//   control and Settings. The collapsed (COMPACT) sidenav keeps an equivalent,
//   usable, accessibly-named theme control.
//
//   EXPANDED footer:  Dark mode [toggle] · Settings
//   COLLAPSED footer: theme icon/control  · Settings
//   Settings is permanent shell navigation (both states), reaching exactly
//   /settings, and is NOT duplicated inside the account/profile popover.
//
// Protects ownership, accessibility and behaviour (the control changes the
// colour mode; Settings reaches /settings) without opening the account menu.
// Deliberately NOT protected: pixel placement, icons, animation, exact copy,
// or whether the theme control is one toggle or a Light/Dark pair. "Near
// Settings" is expressed as co-ownership by the Sidenav, not as geometry.
//
// At 34c1db9c (GH-1158) the footer theme control exists, so the theme cases
// are expected GREEN. RED: Settings still exists only inside the account
// menu — not as permanent shell navigation — in both states.
//
// Mock harness follows tests/unit/ui/commercial-access/sidenav-account-tier.test.tsx.

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockSetMode = jest.fn();
const mockNavigate = jest.fn();

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

jest.mock('@mui/material/styles', () => ({
  ...jest.requireActual('@mui/material/styles'),
  useColorScheme: () => ({ mode: 'light', setMode: mockSetMode }),
}));

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
    user: { first_name: 'Milad', last_name: '', email: 'contact@lasyncro.com' },
    logout: jest.fn(),
  }),
}));

jest.mock('runtime/commercialContext', () => ({
  useCommercialAccess: () => ({
    context: { tier: 'scale', modules: new Set<string>(), flags: new Set<string>() },
    isResolved: true,
    decide: jest.fn(),
  }),
}));

// SidenavContent reads billing-setup truth from EntitlementsContext. Neutral
// resolved paid-billing state keeps the Billing setup card out of this suite.
jest.mock('contexts/EntitlementsContext', () => ({
  useEntitlements: () => ({
    subscriptionStatus: 'active',
    billingProvider: 'shopify',
    hasResolved: true,
    error: null,
  }),
}));
jest.mock('api/axiosConfig', () => ({
  axiosInstance: { post: jest.fn() },
}));

jest.mock('ui-component/third-party/SimpleBar', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('components/UpgradePrompt', () => ({
  UpgradePrompt: () => null,
}));

import SidenavContent from '../../../../apps/frontend/src/layouts/AppLayout/SidenavContent';

const THEME_CONTROL_NAME = /(dark|light) mode|colou?r mode|theme/i;

function renderSidenav(sidenavState: 'EXPANDED' | 'COMPACT') {
  return render(
    <MemoryRouter initialEntries={['/overview']}>
      <SidenavContent
        brandName="laSyncro"
        routes={[]}
        sidenavState={sidenavState}
        isConnected
        isFt2Ready
      />
    </MemoryRouter>,
  );
}

function themeControls(): HTMLElement[] {
  return (['button', 'switch', 'checkbox', 'radio', 'menuitemradio'] as const).flatMap((role) =>
    screen.queryAllByRole(role, { name: THEME_CONTROL_NAME }),
  );
}

function settingsControls(): HTMLElement[] {
  return (['button', 'link'] as const).flatMap((role) =>
    screen.queryAllByRole(role, { name: /^settings$/i }),
  );
}

beforeEach(() => {
  mockSetMode.mockReset();
  mockNavigate.mockReset();
});

describe('OV-V1-0 (G): Sidenav owns the colour-mode control and Settings', () => {
  it('expanded: exposes an accessible theme control without opening the account menu, and it switches to dark mode', () => {
    renderSidenav('EXPANDED');

    expect(screen.queryByRole('menu', { name: 'Account menu' })).not.toBeInTheDocument();

    const controls = themeControls();
    expect(controls.length).toBeGreaterThan(0);

    for (const control of controls) fireEvent.click(control);
    expect(mockSetMode).toHaveBeenCalledWith('dark');
  });

  it('expanded: exposes Settings directly (outside the closed account menu) and it reaches /settings', () => {
    renderSidenav('EXPANDED');

    expect(screen.queryByRole('menu', { name: 'Account menu' })).not.toBeInTheDocument();

    const controls = settingsControls();
    expect(controls.length).toBeGreaterThan(0);

    fireEvent.click(controls[0]);
    const destinations = mockNavigate.mock.calls.map(([path]) => path);
    expect(destinations).toEqual(
      expect.arrayContaining([expect.stringMatching(/^\/settings(\/|$)/)]),
    );
  });

  it('collapsed (COMPACT): retains an accessibly-named, usable theme control', () => {
    renderSidenav('COMPACT');

    const controls = themeControls();
    expect(controls.length).toBeGreaterThan(0);

    for (const control of controls) fireEvent.click(control);
    expect(mockSetMode).toHaveBeenCalledWith('dark');
  });

  it('collapsed (COMPACT): exposes an accessible Settings control without opening the account menu, and it navigates to exactly /settings', () => {
    renderSidenav('COMPACT');

    expect(screen.queryByRole('menu', { name: 'Account menu' })).not.toBeInTheDocument();

    // Accessible name is sufficient — visible "Settings" text is not required
    // in the collapsed rail.
    const controls = settingsControls();
    expect(controls.length).toBeGreaterThan(0);

    fireEvent.click(controls[0]);
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate.mock.calls[0][0]).toBe('/settings');
  });

  it('expanded: Settings is permanent shell navigation and is NOT duplicated inside the account menu', () => {
    renderSidenav('EXPANDED');

    // Captured before the menu opens so the permanent control is proven to
    // live outside the account popover.
    const permanentSettingsBeforeMenu = settingsControls().length;

    fireEvent.click(screen.getByRole('button', { name: /Milad/i }));
    const menu = screen.getByRole('menu', { name: 'Account menu' });

    // Checked first so its own failure is reported independently of the
    // permanent-Settings assertion below.
    expect(within(menu).queryByRole('menuitem', { name: /settings/i })).not.toBeInTheDocument();

    expect(permanentSettingsBeforeMenu).toBeGreaterThan(0);
  });
});
