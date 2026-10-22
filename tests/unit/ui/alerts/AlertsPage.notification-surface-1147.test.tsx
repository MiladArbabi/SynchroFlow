import fs from 'fs';
import path from 'path';
import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  MemoryRouter,
  Route,
  Routes,
} from 'react-router-dom';

import AlertsPage from 'pages/ft2-pages/AlertsPage';
import {
  useMarkNotificationClicked,
  useMarkNotificationRead,
  useNotificationConditions,
  useNotificationPreferences,
  usePushStatus,
  useRecentNotifications,
  useUpdateNotificationPreferences,
} from 'pages/alerts/useNotifications';

jest.mock('pages/alerts/useNotifications', () => ({
  useRecentNotifications: jest.fn(),
  useNotificationPreferences: jest.fn(),
  useNotificationConditions: jest.fn(),
  useMarkNotificationRead: jest.fn(),
  useMarkNotificationClicked: jest.fn(),
  useUpdateNotificationPreferences: jest.fn(),
  usePushStatus: jest.fn(),
}));

jest.mock('components/ModuleTabBar', () => ({
  ModuleTabBar: ({
    tabs,
  }: {
    tabs: Array<{
      id: string;
      label: string;
      path: string;
    }>;
  }) => (
    <div>
      {tabs.map((tab) => (
        <span key={tab.id}>{tab.label}</span>
      ))}
    </div>
  ),
}));

const mockedRecent =
  useRecentNotifications as jest.Mock;
const mockedPreferences =
  useNotificationPreferences as jest.Mock;
const mockedConditions =
  useNotificationConditions as jest.Mock;
const mockedPushStatus =
  usePushStatus as jest.Mock;
const mockedRead =
  useMarkNotificationRead as jest.Mock;
const mockedClicked =
  useMarkNotificationClicked as jest.Mock;
const mockedUpdate =
  useUpdateNotificationPreferences as jest.Mock;

const ID =
  '11111111-1111-4111-8111-111111111111';

const notification = {
  id: ID,
  condition_key: 'orders_cannot_be_fulfilled',
  urgency: 'critical',
  title: 'Orders cannot be fulfilled',
  message: '3 orders need attention.',
  context: {},
  action: {
    route: '/orders',
    label: 'Review orders',
  },
  state: 'unread',
  created_at: '2026-09-23T10:00:00.000Z',
  read_at: null,
  clicked_at: null,
};

const preferences = {
  schema_version: 2,
  urgency: 'important_critical',
  channels: {
    in_app: true,
    push: true,
    email: false,
  },
  quiet_hours: {
    enabled: false,
    start: '22:00',
    end: '07:00',
    allow_critical: true,
  },
  daily_summary: 'off',
  conditions: {},
};

const conditions = [
  {
    key: 'orders_cannot_be_fulfilled',
    area: 'fulfillment',
    merchantLabel: 'Orders cannot be fulfilled',
    urgency: 'critical',
    defaultEnabled: true,
    criticalInAppProtection: true,
    action: {
      route: '/orders',
      label: 'Review orders',
    },
  },
  {
    key: 'not_enough_stock_to_fulfill_orders',
    area: 'inventory',
    merchantLabel:
      'Not enough stock to fulfill orders',
    urgency: 'important',
    defaultEnabled: true,
    criticalInAppProtection: false,
    action: {
      route: '/orders/flow?constraint=inventory',
      label: 'Resolve stockouts',
    },
  },
];

const markRead = jest.fn();
const markClicked = jest.fn();
const updatePreferences = jest.fn();

function renderPage(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/alerts/*"
          element={<AlertsPage />}
        />
        <Route
          path="/orders"
          element={<div>Orders destination</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();

  mockedRecent.mockReturnValue({
    data: {
      notifications: [notification],
      unread_count: 1,
    },
    isLoading: false,
    isError: false,
  });

  mockedPreferences.mockReturnValue({
    data: preferences,
    isLoading: false,
    isError: false,
  });

  mockedConditions.mockReturnValue({
    data: conditions,
    isLoading: false,
    isError: false,
  });

  mockedPushStatus.mockReturnValue({
    data: {
      registered_destination_count: 0,
      has_registered_destination: false,
      web_count: 0,
      expo_count: 0,
    },
    isLoading: false,
    isError: false,
  });

  mockedRead.mockReturnValue({
    mutate: markRead,
    isPending: false,
  });

  mockedClicked.mockReturnValue({
    mutateAsync: markClicked.mockResolvedValue({
      ...notification,
      state: 'clicked',
    }),
    isPending: false,
  });

  mockedUpdate.mockReturnValue({
    mutate: updatePreferences,
    isPending: false,
    isError: false,
  });
});

describe('GH-1147 — Alerts notification surface', () => {
  it('renders Recent notification history and hands CTA to its canonical destination', async () => {
    renderPage('/alerts');

    expect(screen.getByText('Recent')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(
      screen.getByText('3 orders need attention.'),
    ).toBeInTheDocument();
    expect(screen.getByText('1 unread')).toBeInTheDocument();
    expect(screen.getByText('Unread')).toBeInTheDocument();

    fireEvent.click(
      screen.getByText('Orders cannot be fulfilled'),
    );

    expect(markRead).toHaveBeenCalledWith(ID);

    fireEvent.click(
      screen.getByRole('button', {
        name: /Review orders/i,
      }),
    );

    await waitFor(() => {
      expect(markClicked).toHaveBeenCalledWith(ID);
    });

    await waitFor(() => {
      expect(
        screen.getByText('Orders destination'),
      ).toBeInTheDocument();
    });
  });

  it('renders global settings plus only conditions returned by the canonical catalog', () => {
    renderPage('/alerts/settings');

    expect(screen.getByText('Urgency')).toBeInTheDocument();
    expect(screen.getByText('Channels')).toBeInTheDocument();
    expect(screen.getByText('Quiet hours')).toBeInTheDocument();
    expect(
      screen.getByText('What should notify me?'),
    ).toBeInTheDocument();

    expect(
      screen.getByText('Orders cannot be fulfilled'),
    ).toBeInTheDocument();

    expect(
      screen.getByText(
        'Not enough stock to fulfill orders',
      ),
    ).toBeInTheDocument();

    // Immutable in-app state is shown as status, not as a control
    // (asserted in detail by the immutable-state suite below).
    expect(
      screen.getAllByTestId('alerts-always-on').map((el) => el.textContent),
    ).toEqual([
      'In-app notifications: Always on',
      'Orders cannot be fulfilled: Always on',
    ]);
  });

  it('patches canonical global and per-condition preferences', () => {
    renderPage('/alerts/settings');

    fireEvent.click(
      screen.getByRole('switch', {
        name: 'Email notifications',
      }),
    );

    expect(updatePreferences).toHaveBeenCalledWith({
      channels: { email: true },
    });

    fireEvent.click(
      screen.getByRole('switch', {
        name:
          'Notify for Not enough stock to fulfill orders',
      }),
    );

    expect(updatePreferences).toHaveBeenCalledWith({
      conditions: {
        not_enough_stock_to_fulfill_orders: {
          enabled: false,
        },
      },
    });
  });

  it('contains no duplicated condition-key catalog or operational Alerts client dependency', () => {
    const read = (rel: string) => fs.readFileSync(
      path.resolve(__dirname, '../../../../apps/frontend/src', rel),
      'utf8',
    );
    const page = read('pages/ft2-pages/AlertsPage.tsx');
    const panel = read('pages/alerts/AlertsSettingsPanel.tsx');

    for (const source of [page, panel]) {
      expect(source).not.toContain(
        'orders_cannot_be_fulfilled',
      );
      expect(source).not.toContain(
        'not_enough_stock_to_fulfill_orders',
      );
      expect(source).not.toMatch(
        /from ['"].*\/alerts\/useAlerts['"]/,
      );
      expect(source).not.toMatch(/from ['"].*useAlerts['"]/);
    }

    expect(panel).toContain(
      'useNotificationConditions',
    );
  });
});

const PANEL_SRC = path.resolve(
  __dirname,
  '../../../../apps/frontend/src/pages/alerts/AlertsSettingsPanel.tsx',
);

describe('GH-1147 7B2 — Alerts UX playbook parity', () => {
  const source = () => fs.readFileSync(
    path.resolve(
      __dirname,
      '../../../../apps/frontend/src/pages/ft2-pages/AlertsPage.tsx',
    ),
    'utf8',
  );
  const panelSource = () => fs.readFileSync(PANEL_SRC, 'utf8');

  it('keeps Recent + Settings as the only tabs on the canonical ModuleTabBar', () => {
    renderPage('/alerts');

    for (const retired of ['Inbox', 'Snoozed', 'Resolved', 'Rules']) {
      expect(screen.queryByText(retired)).not.toBeInTheDocument();
    }

    const src = source();
    expect(src).toMatch(
      /import \{ ModuleTabBar \} from '\.\.\/\.\.\/components\/ModuleTabBar'/,
    );
    expect(src).toContain('<ModuleTabBar tabs={ALERTS_TABS} />');
    expect(
      Array.from(src.matchAll(/path: '(\/alerts[^']*)'/g), (m) => m[1]),
    ).toEqual(['/alerts', '/alerts/settings']);
  });

  it('inherits the app font — no serif on the FT2 Alerts page', () => {
    expect(source()).not.toContain('var(--serif)');
    expect(panelSource()).not.toContain('var(--serif)');
  });

  it('renders the notification action as a Tier-2 ghost action, not MUI structural blue', () => {
    renderPage('/alerts');

    const cta = screen.getByRole('button', { name: /Review orders/i });
    expect(cta.tagName).toBe('BUTTON');
    expect(cta.className).not.toMatch(/MuiButton-/);

    const src = source();
    const row = src.slice(
      src.indexOf('function NotificationRow'),
      src.indexOf('function RecentPanel'),
    );
    expect(row).toContain("color: 'var(--accent-text)'");
    expect(row).toContain("border: '0.5px solid var(--accent)'");
    expect(row).toContain("borderRadius: '6px'");
    expect(row).toContain('fontWeight: 500');
    expect(src).not.toMatch(/import \{[^}]*\bButton\b[^}]*\} from '@mui\/material'/);
  });

  it('styles every settings Switch neutral-idle / accent-checked and keeps disabled-checked visibly ON', () => {
    const src = panelSource();

    const switchCount = (src.match(/<Switch\b/g) ?? []).length;
    const styledCount =
      (src.match(/<Switch\s+sx=\{ALERTS_SWITCH_SX\}/g) ?? []).length;
    expect(switchCount).toBeGreaterThan(0);
    expect(styledCount).toBe(switchCount);

    const switchSx = src.slice(
      src.indexOf('const ALERTS_SWITCH_SX'),
      src.indexOf('} as const;'),
    );
    expect(switchSx).toMatch(
      /'& \.MuiSwitch-switchBase\.Mui-checked': \{\s*color: 'var\(--accent\)'/,
    );
    expect(switchSx).toMatch(
      /'& \.MuiSwitch-switchBase\.Mui-checked\.Mui-disabled': \{\s*color: 'var\(--accent\)'/,
    );
    expect(switchSx).toMatch(
      /'& \.MuiSwitch-switchBase\.Mui-checked\.Mui-disabled \+ \.MuiSwitch-track': \{\s*bgcolor: 'var\(--accent\)'/,
    );
    expect(src).not.toContain('--confirm-');
  });

  it('puts condition cards on --bg-3 inside the --surface section', () => {
    const src = panelSource();
    const card = src.slice(
      src.indexOf('key={condition.key}'),
      src.indexOf('{condition.merchantLabel}'),
    );
    expect(card).toContain("bgcolor: 'var(--bg-3)'");
    expect(card).not.toContain("'var(--bg-2)'");
  });

  it('maps urgency to theme ink tokens, never raw MUI palette colours', () => {
    const src = source();
    const urgency = src.slice(
      src.indexOf('function urgencyPresentation'),
      src.indexOf('function stateLabel'),
    );
    expect(urgency).toMatch(/'critical'[\s\S]*?color: 'var\(--critical-ink\)'/);
    expect(urgency).toMatch(/'important'[\s\S]*?color: 'var\(--warning-ink\)'/);
    expect(urgency).toMatch(/return \{\s*label: 'Info',[\s\S]*?color: 'var\(--ink-3\)'/);
    expect(urgency).not.toMatch(/(error|warning|info)\.main/);
  });
});

describe('GH-1147 S3 — immutable in-app state is status, not a control', () => {
  it('renders global In-app and the critical condition as "Always on", not as switches', () => {
    renderPage('/alerts/settings');

    expect(
      screen.queryByRole('switch', { name: 'In-app notifications' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('switch', {
        name: 'Notify for Orders cannot be fulfilled',
      }),
    ).not.toBeInTheDocument();

    const locked = screen.getAllByTestId('alerts-always-on');
    expect(locked.map((el) => el.textContent)).toEqual([
      'In-app notifications: Always on',
      'Orders cannot be fulfilled: Always on',
    ]);
    for (const el of locked) {
      expect(el.tagName).toBe('SPAN');
      expect(el).not.toHaveAttribute('role');
      expect(el.querySelector('input, button, [role="switch"]')).toBeNull();
      fireEvent.click(el);
    }
    expect(updatePreferences).not.toHaveBeenCalled();

    expect(
      screen.getByText(/Critical · In-app cannot be disabled/),
    ).toBeInTheDocument();
  });

  it('keeps Push/Email and the non-critical enable toggle as real, interactive switches', () => {
    renderPage('/alerts/settings');

    const interactive = [
      'Push notifications',
      'Email notifications',
      'Notify for Not enough stock to fulfill orders',
      'Push for Orders cannot be fulfilled',
      'Push for Not enough stock to fulfill orders',
    ];
    for (const name of interactive) {
      expect(screen.getByRole('switch', { name })).toBeEnabled();
    }

    // Condition Email stays a real switch, gated only by the global Email
    // master channel (off in this fixture).
    expect(
      screen.getByRole('switch', { name: 'Email for Orders cannot be fulfilled' }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole('switch', { name: 'Push notifications' }));
    expect(updatePreferences).toHaveBeenCalledWith({
      channels: { push: false },
    });

    fireEvent.click(
      screen.getByRole('switch', { name: 'Push for Orders cannot be fulfilled' }),
    );
    expect(updatePreferences).toHaveBeenCalledWith({
      conditions: {
        orders_cannot_be_fulfilled: { push: false },
      },
    });
  });

  it('keeps push preference interactive while truthfully reporting registered destination capability', () => {
    renderPage('/alerts/settings');

    expect(screen.getByText('Push notifications')).toBeInTheDocument();
    expect(screen.queryByText('Mobile push')).not.toBeInTheDocument();

    const pushSwitch = screen.getByRole('switch', {
      name: 'Push notifications',
    });
    expect(pushSwitch).toBeEnabled();
    expect(pushSwitch).toBeChecked();
    expect(screen.getByText('No device registered')).toBeInTheDocument();
    expect(
      screen.getByText(
        "Push won't be delivered until notifications are enabled on a device.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(pushSwitch);
    expect(updatePreferences).toHaveBeenCalledWith({
      channels: { push: false },
    });
    expect(mockedPushStatus).toHaveBeenCalled();

    const panelSource = fs.readFileSync(PANEL_SRC, 'utf8');
    expect(panelSource).not.toMatch(
      /Notification\.requestPermission|PushManager|serviceWorker|subscribe\/web|subscribe\/expo|unsubscribe/,
    );
  });

  it('represents registered push destination capability without changing preference semantics', () => {
    mockedPushStatus.mockReturnValue({
      data: {
        registered_destination_count: 2,
        has_registered_destination: true,
        web_count: 1,
        expo_count: 1,
      },
      isLoading: false,
      isError: false,
    });

    renderPage('/alerts/settings');

    const pushSwitch = screen.getByRole('switch', {
      name: 'Push notifications',
    });
    expect(pushSwitch).toBeChecked();
    expect(pushSwitch).toBeEnabled();
    expect(
      screen.getByText('2 push destinations registered'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Push enabled/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Push working/i)).not.toBeInTheDocument();
  });

  it('uses neutral ink for the locked status — no accent, no --confirm-*', () => {
    const src = fs.readFileSync(PANEL_SRC, 'utf8');
    const status = src.slice(
      src.indexOf('function AlwaysOnStatus'),
      src.indexOf('export default function AlertsSettingsPanel'),
    );
    expect(status).toContain("color: 'var(--ink-3)'");
    expect(status).toContain('<Lock');
    expect(status).not.toContain('--accent');
    expect(status).not.toContain('--confirm-');
    expect(status).not.toMatch(/onClick|<Switch|role=/);
  });
});

describe('GH-1147 S4 — Daily summary is not offered', () => {
  it('renders no Daily summary control or Off/Morning/Evening options', () => {
    renderPage('/alerts/settings');

    expect(screen.queryByText('Daily summary')).not.toBeInTheDocument();
    for (const option of ['Morning', 'Evening']) {
      expect(screen.queryByText(option)).not.toBeInTheDocument();
    }
    expect(
      screen.queryByRole('option', { name: 'Off' }),
    ).not.toBeInTheDocument();

    const src = fs.readFileSync(PANEL_SRC, 'utf8');
    expect(src).not.toMatch(/daily_summary|SUMMARY_LABELS|NotificationDailySummary/);
  });
});
