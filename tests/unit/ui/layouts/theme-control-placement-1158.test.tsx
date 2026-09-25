// tests/unit/ui/layouts/theme-control-placement-1158.test.tsx
//
// GH-1158 — the theme control moved from the top nav into the sidenav footer.
//
// Contracts:
//   - the top nav keeps the Ops Console but has no Light/Dark mode controls,
//     and still reads the scheme for its logo;
//   - the sidenav footer renders exactly one theme control, above the
//     profile/account trigger — a labelled row when expanded, an icon when
//     compact;
//   - the control drives the existing MUI useColorScheme().setMode authority.

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let mockMode: 'light' | 'dark' | 'system' = 'light';
let mockSystemMode: 'light' | 'dark' | undefined;
const mockSetMode = jest.fn();

jest.mock('@mui/material/styles', () => ({
  ...jest.requireActual('@mui/material/styles'),
  useColorScheme: () => ({ mode: mockMode, systemMode: mockSystemMode, setMode: mockSetMode }),
}));

// ── top-nav boundaries (mirrors TopnavbarContent.billing-usage.test.tsx) ──
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => jest.fn(),
}));
jest.mock('lifecycle/ShopLifecycleContext', () => ({
  useShopLifecycle: () => ({ phase: 'FT2_READY' }),
}));
jest.mock('contexts/integration/useIntegration', () => ({
  useIntegration: () => ({ isSyncComplete: true, integrationId: 1, refresh: jest.fn() }),
}));
jest.mock('hooks/useBillingUsage', () => ({
  useBillingUsage: () => ({ data: null }),
}));
jest.mock('components/OpsConsole', () => ({
  OpsConsoleButton: () => <button type="button" aria-label="Ops Console — 0 open" />,
}));
jest.mock('components/TrialCountdownChip', () => ({
  TrialCountdownChip: () => null,
}));

// ── sidenav boundaries (mirrors sidenav-account-tier.test.tsx) ──
jest.mock('runtime/useResolvedNavigation', () => ({
  useResolvedNavigation: () => ({ groups: [] }),
}));
jest.mock('runtime/useModuleHealth', () => ({
  useModuleHealth: () => new Map(),
}));
jest.mock('pages/alerts/useAlerts', () => ({
  useAlerts: () => ({ data: { data: [], meta: { total: 0, status: 'inbox' } } }),
}));
jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'owner', first_name: 'Milad', last_name: '', email: 'contact@lasyncro.com' },
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
jest.mock('api/axiosConfig', () => ({
  axiosInstance: { get: jest.fn(), post: jest.fn() },
}));
jest.mock('ui-component/third-party/SimpleBar', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('components/UpgradePrompt', () => ({
  UpgradePrompt: () => null,
}));

import TopnavbarContent from 'layouts/AppLayout/TopnavbarContent';
import SidenavContent from '../../../../apps/frontend/src/layouts/AppLayout/SidenavContent';

function renderTopnav() {
  return render(
    <MemoryRouter initialEntries={['/overview']}>
      <TopnavbarContent
        isEditing={false}
        onEditToggle={jest.fn()}
        onAddWidget={jest.fn()}
        onToggleSidenav={jest.fn()}
      />
    </MemoryRouter>,
  );
}

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

/** The profile/account trigger: the only menu-opening button in the footer. */
function profileTrigger(): HTMLElement {
  const trigger = screen
    .getAllByRole('button')
    .find((el) => el.getAttribute('aria-haspopup') === 'menu');
  if (!trigger) throw new Error('profile trigger not found');
  return trigger;
}

function expectAbove(upper: HTMLElement, lower: HTMLElement) {
  // eslint-disable-next-line no-bitwise
  expect(upper.compareDocumentPosition(lower) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}

beforeEach(() => {
  mockMode = 'light';
  mockSystemMode = undefined;
  mockSetMode.mockReset();
});

describe('top nav', () => {
  it('keeps the Ops Console but renders no Light mode / Dark mode controls', () => {
    renderTopnav();

    expect(screen.getByRole('button', { name: /Ops Console/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /light mode|dark mode/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/light mode|dark mode/i)).not.toBeInTheDocument();
  });

  it('still reads the scheme for its logo', () => {
    mockMode = 'dark';
    renderTopnav();
    expect(screen.getByAltText('LaSyncro')).toHaveAttribute('src', '/logo-dark.png');
  });
});

describe('sidenav footer theme control', () => {
  it('expanded: renders one labelled "Dark mode" row above the profile/account trigger', () => {
    renderSidenav('EXPANDED');

    const controls = screen.getAllByRole('switch');
    expect(controls).toHaveLength(1);
    expect(controls[0]).toHaveAccessibleName('Dark mode');
    expect(controls[0]).toHaveTextContent('Dark mode');
    expectAbove(controls[0], profileTrigger());
  });

  it('compact: renders the icon variant — same control, no visible label — above the profile trigger', () => {
    renderSidenav('COMPACT');

    const controls = screen.getAllByRole('switch');
    expect(controls).toHaveLength(1);
    expect(controls[0]).toHaveAccessibleName('Dark mode');
    expect(controls[0].textContent).toBe('');
    expectAbove(controls[0], profileTrigger());
  });

  it('switches light → dark through useColorScheme().setMode', () => {
    mockMode = 'light';
    renderSidenav('EXPANDED');

    const control = screen.getByRole('switch', { name: 'Dark mode' });
    expect(control).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(control);

    expect(mockSetMode).toHaveBeenCalledTimes(1);
    expect(mockSetMode).toHaveBeenCalledWith('dark');
  });

  it('switches dark → light through the same authority from the compact icon', () => {
    mockMode = 'dark';
    renderSidenav('COMPACT');

    const control = screen.getByRole('switch', { name: 'Dark mode' });
    expect(control).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(control);

    expect(mockSetMode).toHaveBeenCalledTimes(1);
    expect(mockSetMode).toHaveBeenCalledWith('light');
  });

  it('resolves a "system" mode through the system scheme before toggling', () => {
    mockMode = 'system';
    mockSystemMode = 'dark';
    renderSidenav('EXPANDED');

    const control = screen.getByRole('switch', { name: 'Dark mode' });
    expect(control).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(control);

    expect(mockSetMode).toHaveBeenCalledWith('light');
  });
});
