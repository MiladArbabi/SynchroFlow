// GH-1147 7C — Alerts entry points.
//
// The Alerts module replaces the retired Settings → Notifications and
// Settings → Integrations placeholders. Contract:
//   - profile menu: Alerts → /alerts (module landing), no Integrations shortcut;
//   - settings navigation: one Alerts entry at /settings/alerts that stays in
//     the Settings modal, no Notifications / Integrations placeholders;
//   - legacy /settings/notifications and /settings/integrations both
//     canonicalize to /settings/alerts;
//   - Finance's carrier-label "Configure" CTA goes to Carriers, not the retired
//     Integrations URL;
//   - AlertsSettingsPanel is the single notification-preferences UI, rendered
//     by both /alerts/settings and /settings/alerts.
import fs from 'fs';
import path from 'path';
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';

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
    user: {
      first_name: 'Milad',
      last_name: '',
      email: 'contact@lasyncro.com',
    },
    logout: jest.fn(),
  }),
}));

jest.mock('runtime/commercialContext', () => ({
  useCommercialAccess: () => ({
    context: {
      tier: 'scale',
      modules: new Set<string>(),
      flags: new Set<string>(),
    },
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

// ShopSettingsPage children are out of scope; only its routing is under test.
jest.mock('pages/ft2-pages/ShopSettingsGeneralPage', () => () => <div>General settings</div>);
jest.mock('pages/ft2-pages/ShopSettingsCarriersPage', () => () => <div>Carriers settings</div>);
jest.mock('pages/ft2-pages/ShopSettingsWarehousePage', () => () => <div>Warehouse settings</div>);
jest.mock('pages/ft2-pages/ShopSettingsFinancePage', () => () => <div>Finance settings</div>);
jest.mock('pages/ft2-pages/ShopSettingsReportsPage', () => () => <div>Reports settings</div>);
jest.mock('pages/ft2-pages/ShopifyConnectionsSettings', () => () => <div>Shopify connections settings</div>);
jest.mock('pages/account-settings/BillingSettings', () => () => <div>Billing settings</div>);
jest.mock('pages/account-settings/LocalizationSettings', () => () => <div>Localization settings</div>);
jest.mock('pages/ft2-pages/SettingsShellHeader', () => ({
  SettingsShellHeader: () => null,
}));
// The shared panel's own behaviour is covered by the AlertsPage suite; here
// only its placement inside the Settings routes matters.
jest.mock('pages/alerts/AlertsSettingsPanel', () => () => <div>Shared Alerts settings panel</div>);

import SidenavContent from '../../../../apps/frontend/src/layouts/AppLayout/SidenavContent';
import SettingsModalShell from 'pages/ft2-pages/SettingsModalShell';
import ShopSettingsPage from 'pages/ft2-pages/ShopSettingsPage';
import { SETTINGS_TABS } from 'pages/ft2-pages/settingsTabs';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const FRONTEND_SRC = path.join(REPO_ROOT, 'apps/frontend/src');

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      <span data-testid="location-state">
        {JSON.stringify(location.state ?? null)}
      </span>
    </div>
  );
}

function currentPath(): string {
  const node = screen.getByTestId('location');
  return node.firstChild?.textContent ?? '';
}

function currentState(): unknown {
  return JSON.parse(screen.getByTestId('location-state').textContent ?? 'null');
}

const RETURN_LOCATION = {
  pathname: '/overview',
  search: '',
  hash: '',
};

function renderModal(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/settings"
          element={
            <SettingsModalShell returnLocation={RETURN_LOCATION}>
              <div>Settings body</div>
            </SettingsModalShell>
          }
        />
        <Route
          path="/settings/carriers"
          element={
            <SettingsModalShell returnLocation={RETURN_LOCATION}>
              <div>Settings body</div>
            </SettingsModalShell>
          }
        />
        <Route
          path="/settings/alerts"
          element={
            <SettingsModalShell returnLocation={RETURN_LOCATION}>
              <div>Settings body</div>
            </SettingsModalShell>
          }
        />
        <Route path="*" element={null} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

function listSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

describe('GH-1147 — profile menu entry point', () => {
  it('offers Alerts → /alerts and no Integrations shortcut, closing the menu on navigation', () => {
    render(
      <MemoryRouter initialEntries={['/overview']}>
        <SidenavContent
          brandName="laSyncro"
          routes={[]}
          sidenavState="EXPANDED"
          isConnected
          isFt2Ready
        />
        <LocationProbe />
      </MemoryRouter>,
    );

    const trigger = screen.getByRole('button', { name: /Milad/i });
    fireEvent.click(trigger);
    const menu = screen.getByRole('menu', { name: 'Account menu' });

    expect(within(menu).queryByText('Integrations')).not.toBeInTheDocument();

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Alerts' }));

    expect(currentPath()).toBe('/alerts');
    // Closed state; the Grow exit transition may keep the node mounted briefly.
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('GH-1147 — settings navigation taxonomy', () => {
  it('has exactly one Alerts entry pointing at /settings/alerts and no retired placeholders', () => {
    const alerts = SETTINGS_TABS.filter((tab) => tab.id === 'alerts');
    expect(alerts).toEqual([
      { id: 'alerts', label: 'Alerts', path: '/settings/alerts' },
    ]);

    const ids = SETTINGS_TABS.map((tab) => tab.id);
    const paths = SETTINGS_TABS.map((tab) => tab.path);
    expect(ids).not.toContain('notifications');
    expect(ids).not.toContain('integrations');
    expect(paths).not.toContain('/settings/notifications');
    expect(paths).not.toContain('/settings/integrations');
  });

  it('shows Alerts in the modal sidebar, finds it by search, and hides the retired items', () => {
    renderModal('/settings');

    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(nav).getByRole('button', { name: 'Alerts' })).toBeInTheDocument();
    expect(within(nav).queryByRole('button', { name: 'Notifications' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('button', { name: 'Integrations' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search settings'), {
      target: { value: 'alert' },
    });

    expect(
      within(nav).getAllByRole('button').map((button) => button.getAttribute('title')),
    ).toEqual(['Alerts']);
  });

  it('keeps Alerts as an ordinary Settings route: /settings/alerts, modal open, return location kept', () => {
    renderModal('/settings');

    let nav = screen.getByRole('navigation', { name: 'Settings sections' });
    fireEvent.click(within(nav).getByRole('button', { name: 'Alerts' }));

    expect(currentPath()).toBe('/settings/alerts');
    expect(currentState()).toEqual({ backgroundLocation: RETURN_LOCATION });
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(nav).getByRole('button', { name: 'Alerts' }))
      .toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('button', { name: 'General' }))
      .not.toHaveAttribute('aria-current');
  });

  it('keeps ordinary settings navigation inside the modal with its return location', () => {
    renderModal('/settings/carriers');

    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(nav).getByRole('button', { name: 'Carriers' }))
      .toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('button', { name: 'Alerts' }))
      .not.toHaveAttribute('aria-current');

    fireEvent.click(within(nav).getByRole('button', { name: 'General' }));

    expect(currentPath()).toBe('/settings');
    expect(currentState()).toEqual({ backgroundLocation: RETURN_LOCATION });
  });
});

describe('GH-1147 — legacy settings URLs', () => {
  function renderSettings(entry: string) {
    return render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/settings/*" element={<ShopSettingsPage />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>,
    );
  }

  it('renders the shared AlertsSettingsPanel at /settings/alerts', () => {
    renderSettings('/settings/alerts');

    expect(currentPath()).toBe('/settings/alerts');
    expect(screen.getByText('Shared Alerts settings panel')).toBeInTheDocument();
  });

  it('renders Connections as an ordinary Settings route', () => {
    renderSettings('/settings/connections');

    expect(currentPath()).toBe('/settings/connections');
    expect(screen.getByText('Shopify connections settings')).toBeInTheDocument();
  });

  it('canonicalizes /settings/notifications to /settings/alerts', () => {
    renderSettings('/settings/notifications');

    expect(currentPath()).toBe('/settings/alerts');
    expect(screen.getByText('Shared Alerts settings panel')).toBeInTheDocument();
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
  });

  it('canonicalizes /settings/integrations to /settings/alerts', () => {
    renderSettings('/settings/integrations');

    expect(currentPath()).toBe('/settings/alerts');
    expect(screen.getByText('Shared Alerts settings panel')).toBeInTheDocument();
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
  });
});

describe('GH-1147 — retired /settings/integrations navigation', () => {
  function stripComments(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"])\/\/.*$/gm, '$1');
  }

  it('sends the Finance "No carrier labels" Configure CTA to /settings/carriers', () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, 'modules/finances/src/ui/pages/FinancesModuleFT2.tsx'),
      'utf8',
    );
    const start = src.indexOf('No carrier labels');
    expect(start).toBeGreaterThan(-1);

    const row = src.slice(start, src.indexOf('/>', start));
    expect(row).toContain("label: 'Configure →'");
    expect(row).toContain("window.location.assign('/settings/carriers')");
  });

  it('leaves no product navigation to /settings/integrations', () => {
    const roots = [
      FRONTEND_SRC,
      ...fs.readdirSync(path.join(REPO_ROOT, 'modules'))
        .map((name) => path.join(REPO_ROOT, 'modules', name, 'src'))
        .filter((dir) => fs.existsSync(dir)),
    ];

    const offenders = roots
      .flatMap(listSourceFiles)
      .filter((file) =>
        stripComments(fs.readFileSync(file, 'utf8')).includes('/settings/integrations'))
      .map((file) => path.relative(REPO_ROOT, file));

    expect(offenders).toEqual([]);
  });
});

describe('GH-1147 — single notification-preferences implementation', () => {
  it('AlertsSettingsPanel is the one preferences UI, consumed by both AlertsPage and ShopSettingsPage', () => {
    const roots = [
      FRONTEND_SRC,
      ...fs.readdirSync(path.join(REPO_ROOT, 'modules'))
        .map((name) => path.join(REPO_ROOT, 'modules', name, 'src'))
        .filter((dir) => fs.existsSync(dir)),
    ];

    const consumers = roots
      .flatMap(listSourceFiles)
      .filter((file) => !file.endsWith(path.join('pages', 'alerts', 'useNotifications.ts')))
      .filter((file) =>
        /\buse(Update)?NotificationPreferences\b/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(REPO_ROOT, file));

    expect(consumers).toEqual(['apps/frontend/src/pages/alerts/AlertsSettingsPanel.tsx']);

    // No second copy of the preferences UI anywhere in product source.
    const panelMarkers = roots
      .flatMap(listSourceFiles)
      .filter((file) => fs.readFileSync(file, 'utf8').includes('What should notify me?'))
      .map((file) => path.relative(REPO_ROOT, file));
    expect(panelMarkers).toEqual(['apps/frontend/src/pages/alerts/AlertsSettingsPanel.tsx']);

    const importsPanel = /import AlertsSettingsPanel\s+from '\.\.\/alerts\/AlertsSettingsPanel';/;
    for (const file of ['AlertsPage.tsx', 'ShopSettingsPage.tsx']) {
      const src = fs.readFileSync(path.join(FRONTEND_SRC, 'pages/ft2-pages', file), 'utf8');
      expect(src).toMatch(importsPanel);
      expect(src).toContain('<AlertsSettingsPanel />');
    }

    for (const file of ['ShopSettingsPage.tsx', 'SettingsModalShell.tsx', 'settingsTabs.ts']) {
      const src = fs.readFileSync(path.join(FRONTEND_SRC, 'pages/ft2-pages', file), 'utf8');
      expect(src).not.toMatch(/AlertsPage|useNotifications/);
      // Alerts is an ordinary modal route now; the temporary non-modal
      // handoff helper is gone.
      expect(src).not.toContain('isSettingsModalPath');
    }
  });
});
