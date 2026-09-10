// tests/unit/ui/ops-console/ops-console-surface.test.tsx
//
// OPS-CONSOLE-01 — rendered surface + replacement contracts.
//
// Proves the topnav trigger opens the Ops Console, that the replaced
// "Getting started" popover is gone, that navigating from a row cannot
// manufacture completion state, and that colour comes from theme tokens.
//
// Boundaries are mocked at their public seams (useActivationChecklist,
// useAlerts, useNavigate) rather than re-implementing onboarding or alert
// logic locally.

import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { createTheme } from '@mui/material/styles';

import type { Alert } from 'pages/alerts/useAlerts';
import { ALERT_ROUTE_MAP, alertDeepLink } from 'pages/alerts/alertDeepLink';
import {
  OPS_CONSOLE_WIDTH,
  OPS_ROW_ACTION_BASIS,
  OPS_ROW_SUBJECT_CLAMP,
} from 'components/OpsConsole/OpsConsole';

const mockNavigate = jest.fn();
const mockUseActivationChecklist = jest.fn();
const mockUseAlerts = jest.fn();

jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));

jest.mock('hooks/useActivationChecklist', () => ({
  useActivationChecklist: () => mockUseActivationChecklist(),
}));

jest.mock('pages/alerts/useAlerts', () => ({
  useAlerts: (...args: unknown[]) => mockUseAlerts(...args),
}));

jest.mock('@tanstack/react-query', () => ({
  // Only the onboarding-flags dismissal read goes through useQuery here.
  useQuery: () => ({ data: {} }),
}));

jest.mock('hooks/useAppTheme', () => ({
  useAppTheme: () => ({
    isDark: false,
    bg: 'var(--bg)', bg2: 'var(--bg-2)', bg3: 'var(--bg-3)', surface: 'var(--surface)',
    ink: 'var(--ink)', ink2: 'var(--ink-2)', ink3: 'var(--ink-3)', ink4: 'var(--ink-4)',
    rule: 'var(--rule)', rule2: 'var(--rule-2)',
    accent: 'var(--accent)', accentHover: 'var(--accent-hover)',
    accentGhost: 'var(--accent-ghost)', accentBorder: 'var(--accent-border)',
    rowHover: 'rgba(0,0,0,0.02)', tileHover: 'rgba(0,0,0,0.02)', shadowMd: 'none',
  }),
}));

import { OpsConsoleButton, OpsConsolePanel } from 'components/OpsConsole';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

/**
 * Strips comments so a source-level contract asserts on CODE only. Without this
 * a doc comment that merely NAMES a forbidden call reads as the call itself.
 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .map((line) => line.replace(/\s\/\/.*$/, ''))
    .join('\n');
}
const OPS_CONSOLE_SRC = path.join(REPO_ROOT, 'apps/frontend/src/components/OpsConsole/OpsConsole.tsx');
const TOPNAV_SRC = path.join(REPO_ROOT, 'apps/frontend/src/layouts/AppLayout/TopnavbarContent.tsx');
const CHECKLIST_HOOK_SRC = path.join(REPO_ROOT, 'apps/frontend/src/hooks/useActivationChecklist.ts');

function alert(over: Partial<Alert> = {}): Alert {
  return {
    id: 'a1', alert_key: 'k', source: 'wms', alert_type: 'wms_pick_exception',
    severity: 'critical', title: 'Pick exception on batch 12', message: 'm',
    entity_id: null, entity_type: null, revenue_impact: null, category: null,
    audience: 'all', is_active: true, dismissed_at: null, resolved_at: null,
    acknowledged_at: null, acknowledged_by: null, snoozed_until: null,
    escalated_at: null, rule_id: null,
    created_at: '2026-09-09T10:00:00.000Z', updated_at: '2026-09-09T10:00:00.000Z',
    ...over,
  };
}

const deepLink = () => ({ route: '/problem-center', label: 'Problem Center' });

const SETUP_ITEMS = [
  { key: 'connect-store', label: 'Connect your store', complete: true },
  { key: 'map-zones', label: 'Map your warehouse zones', complete: false, actionRoute: '/floor-planning' },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockUseActivationChecklist.mockReturnValue({
    items: SETUP_ITEMS, completedCount: 1, allComplete: false,
    isLoading: false, isError: false,
  });
  mockUseAlerts.mockReturnValue({
    data: { data: [alert({ id: 'r1', title: 'Resolved one', resolved_at: '2026-09-08T09:00:00.000Z' })],
            meta: { total: 1, status: 'resolved' } },
    isLoading: false, isError: false,
  });
});

function renderPanel(props: Partial<React.ComponentProps<typeof OpsConsolePanel>> = {}) {
  return render(
    <OpsConsolePanel
      alerts={[alert()]}
      deepLink={deepLink}
      open
      onClose={jest.fn()}
      {...props}
    />,
  );
}

// ─── 1 + 10 — TRIGGER AND CLOSE ──────────────────────────────────────────────

describe('topnav trigger', () => {
  it('opens the Ops Console and closes it again without navigating', () => {
    render(<OpsConsoleButton alerts={[alert()]} deepLink={deepLink} />);

    expect(screen.queryByTestId('ops-console')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Ops Console/ }));
    expect(screen.getByTestId('ops-console')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close Ops Console' }));
    expect(screen.queryByTestId('ops-console')).not.toBeInTheDocument();
    // Opening or closing the rail must never move the merchant's route.
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('is not a modal: the console renders no MUI Modal/backdrop over the app', () => {
    render(<OpsConsoleButton alerts={[alert()]} deepLink={deepLink} />);
    fireEvent.click(screen.getByRole('button', { name: /Ops Console/ }));

    expect(document.querySelector('.MuiModal-root')).toBeNull();
    expect(document.querySelector('.MuiBackdrop-root')).toBeNull();
  });
});

// ─── 2 — OLD POPOVER REMOVED ─────────────────────────────────────────────────

describe('Getting Started popover replacement', () => {
  it('no longer exists as a component and is no longer mounted by the topnav', () => {
    expect(fs.existsSync(path.join(REPO_ROOT, 'apps/frontend/src/components/ActivationChecklist.tsx')))
      .toBe(false);

    const topnav = fs.readFileSync(TOPNAV_SRC, 'utf8');
    expect(topnav).not.toMatch(/ActivationChecklistButton/);
    expect(topnav).not.toMatch(/Getting started/);
    expect(topnav).toMatch(/<OpsConsoleButton\b/);
  });
});

// ─── 3 — ONBOARDING TRUTH PRESERVED ──────────────────────────────────────────

describe('onboarding completion truth', () => {
  it('still comes from the two authoritative endpoints via the existing assembler', () => {
    const hook = fs.readFileSync(CHECKLIST_HOOK_SRC, 'utf8');
    expect(hook).toMatch('/api/v1/onboarding/readiness');
    expect(hook).toMatch('/api/v1/user-state/activation-events');

    const console_ = fs.readFileSync(OPS_CONSOLE_SRC, 'utf8');
    expect(console_).toMatch(/useActivationChecklist/);
    // The console must never assemble completion from its own endpoint calls.
    expect(console_).not.toMatch(/onboarding\/readiness/);
    expect(console_).not.toMatch(/activation-events/);
  });
});

// ─── 4 + 5 + 8 — SETUP ROWS, ✓ SOURCE, NAVIGATION SAFETY ─────────────────────

describe('SETUP rows', () => {
  it('navigate to the existing route, and navigating never promotes the row to waiting/verified', () => {
    renderPanel();

    const row = screen.getByTestId('ops-row-setup:map-zones');
    expect(row).toHaveAttribute('data-status', 'actionable');

    fireEvent.click(within(row).getByRole('button', { name: /Open/ }));
    expect(mockNavigate).toHaveBeenCalledWith('/floor-planning');

    // Same authoritative input → same status. No local completion state exists.
    expect(screen.getByTestId('ops-row-setup:map-zones'))
      .toHaveAttribute('data-status', 'actionable');
    expect(screen.queryByTestId('ops-row-setup:map-zones'))
      .not.toHaveAttribute('data-status', 'verified');
  });

  it('shows verified styling only for items the onboarding source reported complete', () => {
    renderPanel();

    fireEvent.click(screen.getByTestId('ops-setup-completed-toggle'));
    expect(screen.getByTestId('ops-row-setup:connect-store'))
      .toHaveAttribute('data-status', 'verified');

    mockUseActivationChecklist.mockReturnValue({
      items: [{ key: 'connect-store', label: 'Connect your store', complete: false }],
      completedCount: 0, allComplete: false, isLoading: false, isError: false,
    });
    renderPanel();
    expect(screen.getAllByTestId('ops-row-setup:connect-store').pop())
      .toHaveAttribute('data-status', 'available');
  });
});

// ─── 6 — BADGE EXCLUDES COMPLETED / HISTORY ──────────────────────────────────

describe('open badge', () => {
  it('counts open NOW + SETUP only, excluding completed setup and resolved outcomes', () => {
    render(
      <OpsConsoleButton
        alerts={[alert({ id: 'a1' }), alert({ id: 'a2', title: 'Second' })]}
        deepLink={deepLink}
      />,
    );
    // 2 open alerts + 1 incomplete setup item; the completed item and the
    // resolved outcome contribute nothing.
    expect(screen.getByRole('button', { name: 'Ops Console — 3 open' })).toBeInTheDocument();
  });

  it('does not grow when navigation occurs', () => {
    render(<OpsConsoleButton alerts={[alert()]} deepLink={deepLink} />);
    fireEvent.click(screen.getByRole('button', { name: /Ops Console/ }));

    const row = screen.getByTestId('ops-row-setup:map-zones');
    fireEvent.click(within(row).getByRole('button', { name: /Open/ }));

    expect(screen.getByRole('button', { name: 'Ops Console — 2 open' })).toBeInTheDocument();
  });
});

// ─── 7 — NOW USES CANONICAL ALERT DATA, NO SECOND INBOX POLL ─────────────────

describe('NOW section', () => {
  it('renders the canonical alerts handed down by the topnav', () => {
    renderPanel({ alerts: [alert({ id: 'a9', title: 'Canonical alert row' })] });

    const row = screen.getByTestId('ops-row-alert:a9');
    expect(row).toHaveTextContent('Canonical alert row');
    expect(row).toHaveAttribute('data-status', 'attention');
  });

  it('never opens its own inbox query — the topnav stays the single poll owner', () => {
    renderPanel();

    const statuses = mockUseAlerts.mock.calls.map(
      ([filters]) => (filters as { status?: string } | undefined)?.status,
    );
    expect(statuses).not.toContain('inbox');
    expect(statuses).toEqual(['resolved']);

    const source = fs.readFileSync(OPS_CONSOLE_SRC, 'utf8');
    expect(source).not.toMatch(/poll:\s*true/);
  });
});

// ─── 9 — OPEN | HISTORY ──────────────────────────────────────────────────────

describe('OPEN | HISTORY filter', () => {
  it('switches between the open working set and authoritative history', () => {
    renderPanel();

    expect(screen.getByTestId('ops-row-alert:a1')).toBeInTheDocument();
    expect(screen.getByTestId('ops-row-setup:map-zones')).toBeInTheDocument();
    expect(screen.getByTestId('ops-row-recent:r1')).toBeInTheDocument();
    expect(screen.queryByTestId('ops-row-history:r1')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'HISTORY' }));

    expect(screen.getByTestId('ops-row-history:r1')).toHaveAttribute('data-status', 'closed');
    expect(screen.queryByTestId('ops-row-alert:a1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ops-row-setup:map-zones')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'OPEN' }));
    expect(screen.getByTestId('ops-row-alert:a1')).toBeInTheDocument();
  });

  it('keeps the authoritative section counts visible inside the rail', () => {
    const { container } = renderPanel({
      alerts: [alert({ id: 'a1' }), alert({ id: 'a2', title: 'Second' })],
    });

    const headers = Array.from(container.querySelectorAll('div'))
      .map(el => el.textContent ?? '');
    expect(headers.some(t => t.startsWith('NOW') && t.endsWith('2'))).toBe(true);
    expect(headers.some(t => t.startsWith('SETUP') && t.endsWith('1'))).toBe(true);
  });

  it('renders WAITING only when authoritative rows exist — absent in V1', () => {
    renderPanel();
    expect(screen.queryByText('WAITING')).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-status="waiting"]')).toHaveLength(0);
  });
});

// ─── LOADING / EMPTY / FAILED ────────────────────────────────────────────────

describe('deliberate states', () => {
  it('distinguishes loading, empty and failed-fetch instead of rendering a silent empty rail', () => {
    mockUseActivationChecklist.mockReturnValue({
      items: [], completedCount: 0, allComplete: false, isLoading: true, isError: false,
    });
    mockUseAlerts.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const loading = renderPanel({ alerts: [] });
    expect(within(loading.container).getByText('Loading setup…')).toBeInTheDocument();
    expect(within(loading.container).getByText('Loading alert history…')).toBeInTheDocument();
    loading.unmount();

    mockUseActivationChecklist.mockReturnValue({
      items: [], completedCount: 0, allComplete: false, isLoading: false, isError: false,
    });
    mockUseAlerts.mockReturnValue({
      data: { data: [], meta: { total: 0, status: 'resolved' } }, isLoading: false, isError: false,
    });
    const empty = renderPanel({ alerts: [] });
    expect(within(empty.container).getByText('No operational items require action.')).toBeInTheDocument();
    expect(within(empty.container).getByText('No closed alerts yet.')).toBeInTheDocument();
    empty.unmount();

    mockUseActivationChecklist.mockReturnValue({
      items: [], completedCount: 0, allComplete: false, isLoading: false, isError: true,
    });
    mockUseAlerts.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    const failed = renderPanel({ alerts: [] });
    expect(within(failed.container).getByText('Setup status unavailable.')).toBeInTheDocument();
    expect(within(failed.container).getByText('Alert history unavailable.')).toBeInTheDocument();
  });
});

// ─── CORRECTION 1 — ALERT HISTORY IS NOT A VERIFIED OUTCOME ──────────────────

describe('alert history semantics', () => {
  it('renders closed alerts neutrally — never with verified status, ✓ glyph or the confirm token', () => {
    const { container } = renderPanel();

    const recent = screen.getByTestId('ops-row-recent:r1');
    expect(recent).toHaveAttribute('data-status', 'closed');
    expect(recent).not.toHaveAttribute('data-status', 'verified');
    expect(recent).not.toHaveTextContent('✓');

    fireEvent.click(screen.getByRole('tab', { name: 'HISTORY' }));
    const history = screen.getByTestId('ops-row-history:r1');
    expect(history).toHaveAttribute('data-status', 'closed');
    expect(history).not.toHaveTextContent('✓');

    // No alert-history row may carry the completion status at all.
    expect(container.querySelectorAll('[data-section="HISTORY"][data-status="verified"]'))
      .toHaveLength(0);
  });

  it('uses neutral wording that claims no causality or constraint resolution', () => {
    const { container } = renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: 'HISTORY' }));

    const text = (container.textContent ?? '').toLowerCase();
    for (const causal of ['verified', 'prevented', 'breach avoided', 'saved', 'intervention', 'outcome']) {
      expect(text).not.toContain(causal);
    }
    expect(container.textContent).toMatch(/ALERT HISTORY/);
  });

  it('keeps the confirm/verified token reserved for onboarding truth in source', () => {
    const source = fs.readFileSync(OPS_CONSOLE_SRC, 'utf8');
    // 'closed' must not be routed to the confirm colour anywhere.
    expect(source).not.toMatch(/'closed'\s*\?\s*'var\(--confirm-ink\)'/);
  });
});

// ─── CORRECTION 2 — PERSISTENT CONSOLE, COMPACT COMPLETED SETUP ──────────────

describe('setup completion and dismissal', () => {
  it('keeps the console reachable after every setup item completes', () => {
    mockUseActivationChecklist.mockReturnValue({
      items: SETUP_ITEMS.map(i => ({ ...i, complete: true })),
      completedCount: 2, allComplete: true, isLoading: false, isError: false,
    });

    render(<OpsConsoleButton alerts={[]} deepLink={deepLink} />);

    // The trigger survives completion — it must never vanish the way the old
    // checklist popover did.
    const trigger = screen.getByRole('button', { name: /Ops Console/ });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAccessibleName('Ops Console — 0 open');

    fireEvent.click(trigger);
    expect(screen.getByTestId('ops-console')).toBeInTheDocument();
  });

  it('collapses an all-complete SETUP section into one compact line, not N completed rows', () => {
    mockUseActivationChecklist.mockReturnValue({
      items: SETUP_ITEMS.map(i => ({ ...i, complete: true })),
      completedCount: 2, allComplete: true, isLoading: false, isError: false,
    });

    const { container } = renderPanel({ alerts: [] });

    expect(screen.getByTestId('ops-setup-complete')).toHaveTextContent('Setup complete · 2/2');
    expect(container.querySelectorAll('[data-section="SETUP"]')).toHaveLength(0);
    expect(screen.queryByTestId('ops-setup-completed-toggle')).not.toBeInTheDocument();
  });

  it('still lists incomplete items individually while completed ones stay subordinate', () => {
    const { container } = renderPanel();

    expect(screen.queryByTestId('ops-setup-complete')).not.toBeInTheDocument();
    expect(screen.getByTestId('ops-row-setup:map-zones')).toHaveAttribute('data-status', 'actionable');
    // The completed one is behind the collapse, not inline.
    expect(container.querySelector('[data-testid="ops-row-setup:connect-store"]')).toBeNull();
    expect(screen.getByTestId('ops-setup-completed-toggle')).toHaveTextContent('1 completed');
  });

  it('carries no "Dismiss checklist" UX and writes no state for the collapse', () => {
    renderPanel();

    expect(screen.queryByText(/dismiss/i)).not.toBeInTheDocument();

    const source = fs.readFileSync(OPS_CONSOLE_SRC, 'utf8');
    // The legacy dismissal mutation is gone.
    expect(source).not.toMatch(/checklist\/dismiss/);
    expect(source).not.toMatch(/useMutation/);
    // The collapse is component state only — no new persistence was introduced.
    expect(source).not.toMatch(/localStorage|sessionStorage/);
    // checklist:completed is still READ, so legacy suppression is preserved.
    expect(source).toMatch(/checklist:completed/);
  });

  it('lets the legacy checklist:completed flag keep suppressing completed SETUP content', () => {
    const rq = jest.requireMock('@tanstack/react-query') as { useQuery: () => unknown };
    const original = rq.useQuery;
    rq.useQuery = () => ({ data: { 'checklist:completed': true } });

    try {
      const { container } = renderPanel({ alerts: [] });
      expect(container.textContent).not.toMatch(/SETUP/);
      expect(screen.queryByTestId('ops-row-setup:map-zones')).not.toBeInTheDocument();
      // The console itself remains — suppression is scoped to SETUP only.
      expect(screen.getByTestId('ops-console')).toBeInTheDocument();
    } finally {
      rq.useQuery = original;
    }
  });
});

// ─── LIVE-BROWSER POLISH CONTRACTS ───────────────────────────────────────────

describe('closed alert rows — readability and chronology', () => {
  it('stay readable: no whole-row opacity, readable ink, neutral glyph, no confirm token', () => {
    renderPanel();

    const row = screen.getByTestId('ops-row-recent:r1');
    // The faded treatment is reserved for genuinely retired rows.
    expect(row).toHaveStyle({ opacity: '1' });
    expect(row).toHaveAttribute('data-status', 'closed');

    const source = fs.readFileSync(OPS_CONSOLE_SRC, 'utf8');
    // Only 'verified' / 'dismissed' may fade a row.
    expect(source).toMatch(/const faded =\s*\n?\s*row\.status === 'verified' \|\| row\.status === 'dismissed';/);
    expect(source).not.toMatch(/faded = .*'closed'/);
    // Label ink for a quiet row is pal.ink3, metadata is pal.ink4.
    expect(source).toMatch(/color: quiet \? pal\.ink3 : pal\.ink/);
  });

  it('show relative chronology, not the redundant word "closed"', () => {
    renderPanel();

    const meta = screen.getByTestId('ops-row-meta-recent:r1');
    expect(meta.textContent).not.toBe('closed');
    expect(meta.textContent).toMatch(/^(just now|\d+m|\d+h|[A-Z][a-z]{2} \d{2})$/);

    // And no visible node anywhere in the rail prints the bare word.
    expect(screen.queryByText('closed')).not.toBeInTheDocument();
  });
});

describe('NOW rows — decluttered subject', () => {
  it('render no visible severity word', () => {
    renderPanel({ alerts: [alert({ id: 'a1', severity: 'critical' })] });

    const row = screen.getByTestId('ops-row-alert:a1');
    // No visible meta column at all on an unacknowledged NOW row.
    expect(screen.queryByTestId('ops-row-meta-alert:a1')).not.toBeInTheDocument();
    expect(screen.getByTestId('ops-row-label-alert:a1').textContent)
      .toBe('Pick exception on batch 12');
    expect(row).not.toHaveTextContent(/\bcritical\b(?![^]*severity)/);
  });

  it('keeps severity exposed accessibly and keeps the colour + rank semantics', () => {
    renderPanel({
      alerts: [
        alert({ id: 'a1', severity: 'critical' }),
        alert({ id: 'a2', severity: 'warning', title: 'Second' }),
      ],
    });

    expect(screen.getByTestId('ops-row-sr-alert:a1')).toHaveTextContent('critical severity');
    expect(screen.getByTestId('ops-row-sr-alert:a2')).toHaveTextContent('warning severity');
    expect(screen.getByTestId('ops-row-alert:a1')).toHaveAttribute('title', 'critical severity');

    // Backend rank order is untouched by the decluttering.
    const rows = Array.from(document.querySelectorAll('[data-section="NOW"]'))
      .map(el => el.getAttribute('data-testid'));
    expect(rows).toEqual(['ops-row-alert:a1', 'ops-row-alert:a2']);
  });

  it('lets a long subject wrap rather than truncating away the identifier', () => {
    // sm keeps the accepted two-line clamp; xs wraps freely (see the responsive
    // block below). Single-line ellipsis truncation is gone either way.
    expect(OPS_ROW_SUBJECT_CLAMP.sm).toBe(2);
    expect(OPS_ROW_SUBJECT_CLAMP.xs).toBe('unset');

    const source = fs.readFileSync(OPS_CONSOLE_SRC, 'utf8');
    expect(source).toMatch(/WebkitLineClamp: OPS_ROW_SUBJECT_CLAMP/);
    expect(source).not.toMatch(/whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'/);
  });
});

describe('OPEN | HISTORY tab focus', () => {
  it('draws keyboard focus with app tokens and leaves no default outline on pointer use', () => {
    const source = fs.readFileSync(OPS_CONSOLE_SRC, 'utf8');

    // Focus indication is preserved — but only for :focus-visible, and painted
    // with the accent token instead of the UA/MUI blue rectangle.
    expect(source).toMatch(/'&:focus-visible':/);
    expect(source).toMatch(/outline: `2px solid \$\{pal\.accent\}`/);
    expect(source).toMatch(/'&:focus': \{ outline: 'none' \}/);
    expect(source).not.toMatch(/outline: 'none'[^]*'&:focus-visible': \{\s*outline: 'none'/);
  });

  it('still switches on click without losing the tab semantics', () => {
    renderPanel();
    const historyTab = screen.getByRole('tab', { name: 'HISTORY' });
    expect(historyTab).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(historyTab);
    expect(screen.getByRole('tab', { name: 'HISTORY' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('top-nav trigger — attention dot, not a second counter', () => {
  it('renders a dot badge with no number while attention is open', () => {
    render(<OpsConsoleButton alerts={[alert()]} deepLink={deepLink} />);

    const dot = document.querySelector('.MuiBadge-badge');
    expect(dot).not.toBeNull();
    expect(dot).toHaveClass('MuiBadge-dot');
    // No printed count anywhere on the trigger.
    expect(dot!.textContent).toBe('');
    expect(screen.getByRole('button', { name: /Ops Console/ }).textContent).toBe('');
    // The count remains available to assistive tech only.
    expect(screen.getByRole('button', { name: 'Ops Console — 2 open' })).toBeInTheDocument();
  });

  it('hides the dot when there is no open attention', () => {
    mockUseActivationChecklist.mockReturnValue({
      items: SETUP_ITEMS.map(i => ({ ...i, complete: true })),
      completedCount: 2, allComplete: true, isLoading: false, isError: false,
    });

    render(<OpsConsoleButton alerts={[]} deepLink={deepLink} />);
    expect(document.querySelector('.MuiBadge-badge')).toHaveClass('MuiBadge-invisible');
  });

  it('keeps the count out of the visible trigger while the rail owns the numbers', () => {
    render(<OpsConsoleButton alerts={[alert()]} deepLink={deepLink} />);
    const trigger = screen.getByRole('button', { name: /Ops Console/ });

    // Non-numeric trigger; the count survives only in the accessible name.
    expect(trigger.textContent).toBe('');
    expect(trigger).toHaveAccessibleName('Ops Console — 2 open');
  });
});

// ─── CONSOLIDATION — ONE TOP-NAV ATTENTION SURFACE ───────────────────────────

describe('top-nav consolidation', () => {
  const topnav = () => fs.readFileSync(TOPNAV_SRC, 'utf8');

  it('mounts the Ops Console trigger and neither of the two surfaces it replaced', () => {
    const src = topnav();

    expect(src).toMatch(/<OpsConsoleButton alerts=\{allInbox\} \/>/);

    // The activation checklist trigger is gone.
    expect(src).not.toMatch(/ActivationChecklist/);
    // The alerts bell trigger, its popover and its row component are gone.
    expect(src).not.toMatch(/BellAlertRow/);
    expect(src).not.toMatch(/bellAnchor|sheetOpen|sheetAlerts/);
    expect(src).not.toMatch(/<Bell\b/);
    expect(src).not.toMatch(/See all alerts/);
    expect(src).not.toMatch(/aria-label=\{`Alerts/);
    // And the duplicate numeric alert count with it.
    expect(src).not.toMatch(/unreadAlerts/);
  });

  it('keeps exactly one shell-level canonical inbox poll, still owned by the topnav', () => {
    const src = topnav();

    // Ownership is unchanged by the bell's removal.
    expect(src).toMatch(/useAlerts\(\s*\n?\s*\{ status: 'inbox' \},\s*\n?\s*\{ enabled: isFt2, poll: true \},\s*\n?\s*\);/);

    const code = codeOnly(src);
    expect(code.match(/useAlerts\(/g)).toHaveLength(1);
    expect(code.match(/poll: true/g)).toHaveLength(1);

    // The console introduces no second owner.
    const console_ = codeOnly(fs.readFileSync(OPS_CONSOLE_SRC, 'utf8'));
    expect(console_).not.toMatch(/poll:\s*true/);
    expect(console_).not.toMatch(/status: 'inbox'/);
  });

  it('hands the canonical inbox data to the console exactly once', () => {
    const code = codeOnly(topnav());
    expect(code.match(/allInbox/g)).toHaveLength(2);   // one assignment, one pass-down
    expect(code).toMatch(/const allInbox\s+= alertsData\?\.data \?\? \[\];/);
  });

  it('renders NOW from the handed-down data with no query of its own', () => {
    renderPanel({ alerts: [alert({ id: 'a7', title: 'Handed-down alert' })] });

    expect(screen.getByTestId('ops-row-alert:a7')).toHaveTextContent('Handed-down alert');
    const statuses = mockUseAlerts.mock.calls.map(
      ([filters]) => (filters as { status?: string } | undefined)?.status,
    );
    expect(statuses).toEqual(['resolved']);
  });
});

// ─── ALERT ROUTING PRESERVED THROUGH THE EXTRACTION ──────────────────────────

describe('alert deep-link mapping', () => {
  it('is owned by one shared module, not redefined by the console or the topnav', () => {
    const console_ = fs.readFileSync(OPS_CONSOLE_SRC, 'utf8');
    const topnavSrc = fs.readFileSync(TOPNAV_SRC, 'utf8');

    expect(console_).toMatch(/from '\.\.\/\.\.\/pages\/alerts\/alertDeepLink'/);
    // Neither surface carries a copy of the map.
    expect(console_).not.toMatch(/wms_pick_exception/);
    expect(topnavSrc).not.toMatch(/wms_pick_exception/);
    expect(topnavSrc).not.toMatch(/BELL_ROUTE_MAP|bellDeepLink/);
  });

  it('preserves the destination of every alert type that was mapped before', () => {
    // Frozen from the pre-extraction BELL_ROUTE_MAP. A silent destination loss
    // or rename fails here.
    const EXPECTED: Record<string, { route: string; label: string }> = {
      wms_pick_exception:      { route: '/problem-center', label: 'Problem Center' },
      wms_pack_exception:      { route: '/problem-center', label: 'Problem Center' },
      wms_stow_pending:        { route: '/wms',            label: 'Warehouse' },
      wms_stow_exception:      { route: '/problem-center', label: 'Problem Center' },
      wms_batch_ready_to_pack: { route: '/wms',            label: 'Warehouse' },
      wms_batch_ready_to_ship: { route: '/wms',            label: 'Warehouse' },
      wms_batch_released:      { route: '/wms',            label: 'Warehouse' },
      wms_receive_arrived:     { route: '/wms',            label: 'Warehouse' },
      wms_receive_exception:   { route: '/problem-center', label: 'Problem Center' },
      stockout_risk:           { route: '/suppliers-portal/sourcing', label: 'Sourcing' },
      reorder_warning:         { route: '/suppliers-portal/sourcing', label: 'Sourcing' },
      revenue_at_risk:         { route: '/overview',       label: 'Overview' },
      operational:             { route: '/orders',         label: 'Orders' },
      sla_breach:              { route: '/orders',         label: 'Orders' },
      missing_cogs:            { route: '/inventory/costs', label: 'Costs' },
    };

    expect(ALERT_ROUTE_MAP).toEqual(EXPECTED);

    for (const alert_type of Object.keys(EXPECTED)) {
      expect(alertDeepLink(alert({ alert_type }))).toEqual(EXPECTED[alert_type]);
    }

    // Variant scoping survives the move.
    expect(alertDeepLink(alert({
      alert_type: 'stockout_risk', entity_type: 'variant', entity_id: '4450',
    }))).toEqual({ route: '/suppliers-portal/sourcing?variantId=4450', label: 'Sourcing' });

    // Unmapped types still resolve to nothing rather than a guess.
    expect(alertDeepLink(alert({ alert_type: 'not_a_real_type' }))).toBeNull();
  });

  it('routes a NOW row through the shared resolver by default (no prop supplied)', () => {
    render(
      <OpsConsolePanel
        alerts={[alert({ id: 'a1', alert_type: 'missing_cogs' })]}
        open
        onClose={jest.fn()}
      />,
    );

    fireEvent.click(within(screen.getByTestId('ops-row-alert:a1')).getByRole('button', { name: /Costs/ }));
    expect(mockNavigate).toHaveBeenCalledWith('/inventory/costs');
  });
});

// ─── /alerts PRESERVED + REACHABLE ───────────────────────────────────────────

describe('advanced alert workspace', () => {
  it('"Manage alerts" is the one subtle path to /alerts', () => {
    renderPanel();

    const link = screen.getByTestId('ops-manage-alerts');
    expect(link).toHaveTextContent('Manage alerts');
    fireEvent.click(link);
    expect(mockNavigate).toHaveBeenCalledWith('/alerts');
  });

  it('adds no acknowledge/snooze/resolve/rules management of its own', () => {
    const console_ = codeOnly(fs.readFileSync(OPS_CONSOLE_SRC, 'utf8'));
    for (const control of ['acknowledge', 'useAcknowledgeAlert', 'snooze', 'useResolveAlert', 'Rules']) {
      expect(console_).not.toMatch(new RegExp(control, 'i'));
    }
    // Sanity: the stripper did not simply empty the file.
    expect(console_).toMatch(/OpsConsolePanel/);
  });

  it('leaves the /alerts routes and their tab paths untouched', () => {
    const host = fs.readFileSync(
      path.join(REPO_ROOT, 'apps/frontend/src/lifecycle/LifecycleRouteHost.tsx'), 'utf8');
    expect(host).toMatch(/<Route path="\/alerts\/\*" element=\{<AlertsPage \/>\} \/>/);

    const alertsPage = fs.readFileSync(
      path.join(REPO_ROOT, 'apps/frontend/src/pages/ft2-pages/AlertsPage.tsx'), 'utf8');
    for (const p of ['/alerts', '/alerts/snoozed', '/alerts/resolved', '/alerts/rules']) {
      expect(alertsPage).toMatch(`path: '${p}'`);
    }
  });
});

// ─── NARROW-VIEWPORT (xs) RESPONSIVE CONTRACT ────────────────────────────────
//
// jsdom does not lay out, so it cannot prove physical clipping. What IS proved
// here: which branch of each responsive token a given viewport resolves to, and
// that no fixed/min width in the row or action path can produce overflow.
// Physical proof at 390px stays a required browser step.

describe('xs responsive layout', () => {
  // The project defines no custom breakpoints, so MUI defaults apply.
  const SM_BREAKPOINT = 600;
  const NARROW = [320, 375, 390];

  /** Which branch of a { xs, sm } token a viewport width resolves to. */
  const resolve = <T,>(token: { xs: T; sm: T }, width: number): T =>
    width >= SM_BREAKPOINT ? token.sm : token.xs;

  it('uses the MUI default sm breakpoint, so 320/375/390 are all xs', () => {
    const theme = createTheme();
    expect(theme.breakpoints.values.sm).toBe(SM_BREAKPOINT);
    for (const w of NARROW) expect(w).toBeLessThan(SM_BREAKPOINT);
  });

  it('resolves to full viewport width at 320/375/390 — not a fixed 340px rail', () => {
    for (const w of NARROW) {
      expect(resolve(OPS_CONSOLE_WIDTH, w)).toBe('100vw');
      // 340px would be WIDER than a 320px viewport and NARROWER than 390px —
      // the exact bug: a strip of the app left visible.
      expect(resolve(OPS_CONSOLE_WIDTH, w)).not.toBe(340);
    }
  });

  it('retains the accepted compact desktop rail at sm and above', () => {
    for (const w of [SM_BREAKPOINT, 768, 1024, 1440]) {
      expect(resolve(OPS_CONSOLE_WIDTH, w)).toBe(340);
    }
  });

  it('pins both edges and measures against the viewport, with border-box sizing', () => {
    const source = fs.readFileSync(OPS_CONSOLE_SRC, 'utf8');

    expect(source).toMatch(/left: \{ xs: 0, sm: 'auto' \}/);
    expect(source).toMatch(/right: 0/);
    expect(source).toMatch(/width: OPS_CONSOLE_WIDTH/);
    expect(source).toMatch(/maxWidth: '100vw'/);
    expect(source).toMatch(/boxSizing: 'border-box'/);
    expect(source).toMatch(/overflowX: 'hidden'/);
    // The old bug: '100%' on a position:fixed panel resolves against whatever
    // containing block an ancestor establishes, not the viewport.
    expect(OPS_CONSOLE_WIDTH.xs).not.toBe('100%');
  });

  it('reflows the CTA onto its own line at xs and keeps it inline at sm', () => {
    for (const w of NARROW) expect(resolve(OPS_ROW_ACTION_BASIS, w)).toBe('100%');
    for (const w of [SM_BREAKPOINT, 1440]) expect(resolve(OPS_ROW_ACTION_BASIS, w)).toBe('auto');

    const source = fs.readFileSync(OPS_CONSOLE_SRC, 'utf8');
    // The row must be allowed to wrap on xs and forbidden from wrapping on sm.
    expect(source).toMatch(/flexWrap: \{ xs: 'wrap', sm: 'nowrap' \}/);
    expect(source).toMatch(/flexBasis: OPS_ROW_ACTION_BASIS/);
  });

  it('never lets the CTA shrink or wrap its label — the subject gives way instead', () => {
    const source = fs.readFileSync(OPS_CONSOLE_SRC, 'utf8');

    // CTA: fixed size, unbreakable label.
    expect(source).toMatch(/flexShrink: 0, whiteSpace: 'nowrap'/);
    // Subject: the flexible one, and allowed to reach zero width.
    expect(source).toMatch(/flex: '1 1 auto', minWidth: 0/);
    expect(source).toMatch(/overflowWrap: 'anywhere'/);
    // No fixed or minimum width anywhere in the row/action path that could
    // force horizontal overflow. (width:10 is the glyph column; the sr-only
    // node's width:1 is off-screen; 6 is the trigger dot.)
    const widths = [...source.matchAll(/\bmin[Ww]idth: (\d+)/g)].map(m => Number(m[1]));
    expect(widths.filter(n => n > 0)).toEqual([6]);
  });

  it('renders a complete, untruncated CTA label with its own tappable wrapper', () => {
    // No deepLink prop: the real shared resolver runs, so the label is the
    // genuine destination label rather than a stub's.
    render(
      <OpsConsolePanel
        alerts={[alert({ id: 'a1', alert_type: 'sla_breach' })]}
        open
        onClose={jest.fn()}
      />,
    );

    const wrap = screen.getByTestId('ops-row-action-wrap-alert:a1');
    const cta = within(wrap).getByRole('button');
    // Full label + affordance, nothing elided.
    expect(cta.textContent).toBe('Orders →');
    expect(cta.textContent).not.toMatch(/…|\.\.\./);
    fireEvent.click(cta);
    expect(mockNavigate).toHaveBeenCalledWith('/orders');
  });

  it('keeps a long subject complete in the DOM so wrapping, not clipping, applies', () => {
    const LONG = 'Variant 4450 out of stock at the Rotterdam fulfilment centre and blocked';
    renderPanel({ alerts: [alert({ id: 'a1', title: LONG })] });

    expect(screen.getByTestId('ops-row-label-alert:a1').textContent).toBe(LONG);
  });

  it('keeps header, tabs, close control, section counts and Manage alerts present', () => {
    renderPanel({ alerts: [alert({ id: 'a1' })] });

    expect(screen.getByLabelText('Ops Console')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close Ops Console' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'OPEN' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'HISTORY' })).toBeInTheDocument();
    expect(screen.getByTestId('ops-manage-alerts')).toBeInTheDocument();

    // Section labels and their counts both survive the narrow layout.
    const texts = Array.from(document.querySelectorAll('div')).map(el => el.textContent ?? '');
    expect(texts.some(t => t.startsWith('NOW') && t.endsWith('1'))).toBe(true);
    expect(texts.some(t => t.startsWith('SETUP') && t.endsWith('1'))).toBe(true);
  });

  it('adds no oversized padding to buy the reflow', () => {
    const source = fs.readFileSync(OPS_CONSOLE_SRC, 'utf8');
    expect(source).toMatch(/rowGap: 0\.5/);
    // Row vertical padding is unchanged from the approved desktop treatment.
    expect(source).toMatch(/px: 1\.5, py: 0\.75,/);
  });
});

// ─── 11 — THEME TOKENS, NOT HARD-CODED SURFACES ──────────────────────────────

describe('theming', () => {
  it('takes every colour from theme tokens so light and dark both resolve', () => {
    const source = fs.readFileSync(OPS_CONSOLE_SRC, 'utf8');

    // No literal colours of any form in the component.
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\brgba?\(/);

    // And the surfaces it does paint come from the canonical token hook.
    expect(source).toMatch(/pal\.surface/);
    expect(source).toMatch(/pal\.rule/);
    expect(source).toMatch(/var\(--critical-ink\)/);
    expect(source).toMatch(/var\(--confirm-ink\)/);
  });
});
