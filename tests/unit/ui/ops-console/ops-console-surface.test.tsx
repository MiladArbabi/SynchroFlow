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
import { act, render, screen, within, fireEvent, waitFor, waitForElementToBeRemoved } from '@testing-library/react';
import { createTheme } from '@mui/material/styles';

import type { Alert } from 'pages/alerts/useAlerts';
import { ALERT_ROUTE_MAP, alertDeepLink } from 'pages/alerts/alertDeepLink';
import {
  OPS_CONSOLE_WIDTH,
  OPS_ROW_ACTION_COLUMN,
  OPS_ROW_SUBJECT_CLAMP,
} from 'components/OpsConsole/OpsConsole';

const mockNavigate = jest.fn();
const mockUseActivationChecklist = jest.fn();
const mockUseWaiting = jest.fn();
// OPS-CONSOLE-HISTORY-01 — HISTORY is now backend-classified, not
// alert-resolved-status-classified. Resolved alerts remain Alerts' own
// concern; the console no longer calls useAlerts at all (its only prior
// call site, the resolvedQuery, was removed with buildAlertHistoryRows'
// wiring), so no useAlerts mock is registered here any more.
const mockUseHistory = jest.fn();

jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));

// #1164: the real pure selection/route helpers stay live; only the hook is mocked.
jest.mock('hooks/useActivationChecklist', () => ({
  ...jest.requireActual('hooks/useActivationChecklist'),
  useActivationChecklist: () => mockUseActivationChecklist(),
}));

jest.mock('pages/operations/useHistory', () => ({
  useHistory: (...args: unknown[]) => mockUseHistory(...args),
}));

// OPS-CONSOLE-WAITING-01 — badge/WAITING boundary (correction pass, item D).
// Not consumed by OpsConsoleButton today (it has no waitingItems prop and
// never calls useWaiting), so this mock is inert for every existing test in
// this file. It exists so the new 'open badge' case below can populate the
// WAITING feed and prove the badge stays unaffected regardless of whether a
// future wiring change ever routes WAITING data through this hook.
jest.mock('pages/operations/useWaiting', () => ({
  useWaiting: (...args: unknown[]) => mockUseWaiting(...args),
}));

// HISTORY-ORDER-ENTITY-01 — a HISTORY row's CTA now sets selectedOrderId and
// renders the real OrderDetailModalBody, which needs providers (entitlements,
// currency) this file never set up (no other existing test here previously
// exercised that state). Mocked at the same seam
// ops-console-global-search.test.tsx already uses, so the HISTORY-CTA test
// below can assert "no navigation" without crashing on missing context.
// GH-1165 — the first-contact Spotlight renders the REAL shared coach mark.
jest.mock('@lasyncro/shared/ui', () => ({
  EntityDetailModal: ({ entityId, title, children, footerActions, onClose }: any) =>
    entityId ? (
      <section data-testid="entity-detail-modal" aria-label={title}>
        <button aria-label="Dismiss modal" onClick={onClose} />
        {children}
        {footerActions}
      </section>
    ) : null,
  SpotlightCoachMark: jest.requireActual('../../../../modules/shared/src/ui/SpotlightCoachMark').SpotlightCoachMark,
}));

jest.mock('pages/orders/OrderDetailModalBody', () => ({
  OrderDetailModalBody: ({ orderId }: { orderId: string }) => (
    <div data-testid="order-detail-body">ORDER:{orderId}</div>
  ),
}));

jest.mock('pages/wms/usePickBatches', () => ({
  usePickBatches: () => ({
    data: { batches: [] },
    isLoading: false,
    isError: false,
  }),
  usePickBatchOrders: () => ({
    data: { orders: [] },
    isLoading: false,
    isError: false,
  }),
}));

// GH-1165 — the intro-seen write updates the shared onboarding-flags cache.
const mockSetQueryData = jest.fn();

jest.mock('@tanstack/react-query', () => ({
  // Only the onboarding-flags dismissal read goes through useQuery here.
  useQuery: () => ({ data: {} }),
  useMutation: () => ({ mutateAsync: jest.fn() }),
  useQueryClient: () => ({ invalidateQueries: jest.fn(), setQueryData: mockSetQueryData }),
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
import { axiosInstance } from 'api/axiosConfig';
import { ConfigProvider } from 'contexts/ConfigContext';
import useConfig from 'hooks/useConfig';

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

function opsConsoleRowSource(): string {
  const source = fs.readFileSync(OPS_CONSOLE_SRC, 'utf8');
  const start = source.indexOf('function OpsConsoleRow(');
  const end = source.indexOf('function SectionHeader(', start);

  if (start === -1 || end === -1) {
    throw new Error('Unable to locate OpsConsoleRow source block');
  }

  return source.slice(start, end);
}

function alert(over: Partial<Alert> = {}): Alert {
  return {
    id: 'a1', alert_key: 'k', source: 'wms', alert_type: 'wms_pick_exception',
    severity: 'critical', title: 'Pick exception on batch 12', message: 'm',
    entity_id: null, entity_type: null, revenue_impact: null, category: null,
    audience: 'all', is_active: true, dismissed_at: null, resolved_at: null,
    acknowledged_at: null, acknowledged_by: null, snoozed_until: null,
    escalated_at: null, rule_id: null,
    created_at: '2026-09-09T10:00:00.000Z', updated_at: '2026-09-09T10:00:00.000Z',
    treatment: null, action: null,
    ...over,
  };
}

const deepLink = () => ({ route: '/problem-center', label: 'Problem Center' });

const SETUP_ITEMS = [
  { key: 'connect-store', label: 'Connect your store', complete: true },
  { key: 'map-zones', label: 'Map your warehouse zones', complete: false, actionRoute: '/floor-planning?tab=setup&view=canvas' },
];

/**
 * OPS-CONSOLE-HISTORY-01 — backend HISTORY V1 feed item fixture, mirroring
 * the real GET /api/v1/operations/history contract verbatim (same shape as
 * waitingItem() in ops-console-waiting-v1-contract.test.tsx, plus
 * resolvedAt/outcome='verified_resolved'). `interventionId: 'r1'` keeps this
 * default fixture's row id ('history:r1') identical to the row id every
 * pre-existing HISTORY assertion in this file already targets.
 */
function historyItem(over: Record<string, unknown> = {}) {
  return {
    interventionId: 'r1',
    treatment: 'address_correction',
    lasyncroOrderId: 'order-hist-1',
    externalOrderId: '#2001',
    constraintId: 'constraint-hist-1',
    constraintType: 'customer',
    blockType: 'incomplete_address',
    occurredAt: '2026-09-08T08:00:00.000Z',
    resolvedAt: '2026-09-08T09:00:00.000Z',
    outcome: 'verified_resolved',
    presentation: {
      title: 'Resolved one',
      subtitle: 'Canonical verification confirmed the address block cleared.',
      actionLabel: 'View order',
    },
    // HISTORY-ORDER-ENTITY-01 — order_entity, never a route.
    routing: { kind: 'order_entity', lasyncroOrderId: 'order-hist-1' },
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseActivationChecklist.mockReturnValue({
    items: SETUP_ITEMS, completedCount: 1, allComplete: false,
    isLoading: false, isError: false,
  });
  mockUseHistory.mockReturnValue({
    data: { items: [historyItem()] },
    isLoading: false, isError: false,
  });
  mockUseWaiting.mockReturnValue({
    data: { items: [] },
    isLoading: false, isError: false,
  });
});

/** SETUP is collapsed by default now; open it when a test needs its rows. */
function expandSetup() {
  fireEvent.click(screen.getByTestId('ops-setup-toggle'));
}

// OVERVIEW-SCREEN-OPT-01 — the trigger's open/closed state is shared
// ConfigContext state, so it renders under the real ConfigProvider (the app
// mounts it at the root).
function renderButton(ui: React.ReactElement) {
  return render(<ConfigProvider>{ui}</ConfigProvider>);
}

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
  it('opens the Ops Console and closes it again without navigating', async () => {
    renderButton(<OpsConsoleButton alerts={[alert()]} deepLink={deepLink} />);

    expect(screen.queryByTestId('ops-console')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Ops Console/ }));
    expect(screen.getByTestId('ops-console')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close Ops Console' }));
    // GH-1158: the rail reverses out before it unmounts, then is gone.
    await waitForElementToBeRemoved(() => screen.queryByTestId('ops-console'));
    // Opening or closing the rail must never move the merchant's route.
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('toggles open and closed from the trigger itself, without navigating', async () => {
    renderButton(<OpsConsoleButton alerts={[alert()]} deepLink={deepLink} />);
    const trigger = screen.getByRole('button', { name: /Ops Console/ });

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('complementary', { name: 'Ops Console' })).toBeInTheDocument();

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await waitForElementToBeRemoved(() => screen.queryByTestId('ops-console'));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('stays mounted only through the exit animation: hidden and inert while closing, then unmounted', async () => {
    renderButton(<OpsConsoleButton alerts={[alert()]} deepLink={deepLink} />);
    fireEvent.click(screen.getByRole('button', { name: /Ops Console/ }));

    const panel = screen.getByTestId('ops-console');
    expect(panel).not.toHaveAttribute('aria-hidden');
    expect(panel).not.toHaveAttribute('inert');

    fireEvent.click(screen.getByRole('button', { name: 'Close Ops Console' }));

    // Exit in progress: still in the DOM for the reverse slide, but no longer
    // exposed to assistive tech or reachable by keyboard/pointer.
    expect(screen.getByTestId('ops-console')).toBe(panel);
    expect(panel).toHaveAttribute('aria-hidden', 'true');
    expect(panel).toHaveAttribute('inert');
    expect(screen.queryByRole('complementary', { name: 'Ops Console' })).not.toBeInTheDocument();

    await waitForElementToBeRemoved(panel);
  });

  it('reflects the visible console state in shared ConfigContext state (OVERVIEW-SCREEN-OPT-01)', async () => {
    function SharedState() {
      const { state } = useConfig();
      return <output data-testid="shared-console-open">{String(state.isOpsConsoleOpen)}</output>;
    }
    renderButton(
      <>
        <OpsConsoleButton alerts={[alert()]} deepLink={deepLink} />
        <SharedState />
      </>,
    );
    const trigger = screen.getByRole('button', { name: /Ops Console/ });
    const shared = screen.getByTestId('shared-console-open');

    expect(shared).toHaveTextContent('false');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);
    expect(shared).toHaveTextContent('true');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('ops-console')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close Ops Console' }));
    expect(shared).toHaveTextContent('false');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await waitForElementToBeRemoved(() => screen.queryByTestId('ops-console'));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('owns no private open state: the trigger reads and writes shared ConfigContext state (OVERVIEW-SCREEN-OPT-01)', () => {
    const source = codeOnly(fs.readFileSync(OPS_CONSOLE_SRC, 'utf8'));
    const start = source.indexOf('export function OpsConsoleButton(');
    expect(start).toBeGreaterThan(-1);
    // OpsConsoleButton is the file's final declaration, so its block runs to EOF.
    const button = source.slice(start);

    expect(button).not.toMatch(/\[\s*open\s*,\s*setOpen\s*\]\s*=\s*useState/);
    expect(button).not.toMatch(/\bsetOpen\b/);
    expect(button).toMatch(/useConfig\(\)/);
    expect(button).toMatch(/type:\s*'SET_OPS_CONSOLE'/);
  });

  it('mounts nothing while closed, as before', () => {
    renderPanel({ open: false });
    expect(screen.queryByTestId('ops-console')).not.toBeInTheDocument();
  });

  it('is not a modal: the console renders no MUI Modal/backdrop over the app', () => {
    renderButton(<OpsConsoleButton alerts={[alert()]} deepLink={deepLink} />);
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
    expandSetup();

    const row = screen.getByTestId('ops-row-setup:map-zones');
    expect(row).toHaveAttribute('data-status', 'actionable');

    fireEvent.click(within(row).getByRole('button', { name: /Open/ }));
    expect(mockNavigate).toHaveBeenCalledWith('/floor-planning?tab=setup&view=canvas');

    // Same authoritative input → same status. No local completion state exists.
    expect(screen.getByTestId('ops-row-setup:map-zones'))
      .toHaveAttribute('data-status', 'actionable');
    expect(screen.queryByTestId('ops-row-setup:map-zones'))
      .not.toHaveAttribute('data-status', 'verified');
  });

  it('shows verified styling only for items the onboarding source reported complete', () => {
    renderPanel();
    expandSetup();

    fireEvent.click(screen.getByTestId('ops-setup-completed-toggle'));
    expect(screen.getByTestId('ops-row-setup:connect-store'))
      .toHaveAttribute('data-status', 'verified');

    mockUseActivationChecklist.mockReturnValue({
      items: [{ key: 'connect-store', label: 'Connect your store', complete: false }],
      completedCount: 0, allComplete: false, isLoading: false, isError: false,
    });
    renderPanel();
    fireEvent.click(screen.getAllByTestId('ops-setup-toggle').pop()!);
    expect(screen.getAllByTestId('ops-row-setup:connect-store').pop())
      .toHaveAttribute('data-status', 'available');
  });
});

// ─── 6 — BADGE EXCLUDES COMPLETED / HISTORY ──────────────────────────────────

describe('open badge', () => {
  it('counts open NOW + SETUP only, excluding completed setup and resolved outcomes', () => {
    renderButton(
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
    renderButton(<OpsConsoleButton alerts={[alert()]} deepLink={deepLink} />);
    fireEvent.click(screen.getByRole('button', { name: /Ops Console/ }));
    expandSetup();

    const row = screen.getByTestId('ops-row-setup:map-zones');
    fireEvent.click(within(row).getByRole('button', { name: /Open/ }));

    expect(screen.getByRole('button', { name: 'Ops Console — 2 open' })).toBeInTheDocument();
  });

  // OPS-CONSOLE-WAITING-01 correction pass — badge/WAITING boundary (item D).
  // NOW = needs attention; WAITING = already acted / no attention count. A
  // populated WAITING feed must never make the trigger's badge non-zero.
  // This is expected to already be GREEN: OpsConsoleButton's badge formula
  // never spreads buildWaitingRows(...) into openAttentionCount's input.
  it('a populated WAITING feed does not make the badge non-zero when NOW/SETUP are both empty', () => {
    mockUseActivationChecklist.mockReturnValue({
      items: [{ key: 'connect-store', label: 'Connect your store', complete: true }],
      completedCount: 1, allComplete: true, isLoading: false, isError: false,
    });
    mockUseWaiting.mockReturnValue({
      data: {
        items: [
          {
            interventionId: 'intv-badge-1',
            treatment: 'address_correction',
            lasyncroOrderId: 'order-badge-1',
            externalOrderId: '#9001',
            constraintId: 'constraint-badge-1',
            constraintType: 'customer',
            blockType: 'incomplete_address',
            occurredAt: '2026-09-18T10:00:00.000Z',
            outcome: 'pending_verification',
            presentation: {
              title: 'Address correction submitted',
              subtitle: 'Waiting on canonical verification.',
              actionLabel: 'Review address',
            },
            routing: { route: '/overview?resolution=address' },
          },
        ],
      },
      isLoading: false, isError: false,
    });

    renderButton(<OpsConsoleButton alerts={[]} deepLink={deepLink} />);

    expect(screen.getByRole('button', { name: 'Ops Console — 0 open' })).toBeInTheDocument();
    expect(document.querySelector('.MuiBadge-badge')).toHaveClass('MuiBadge-invisible');
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

    // OPS-CONSOLE-HISTORY-01: the console's only former useAlerts call site
    // (the resolvedQuery backing HISTORY) is gone — HISTORY now reads
    // useHistory() instead, so there is no useAlerts mock left to assert
    // against here. The invariant this test protects (no second inbox poll)
    // is proved by the absence of `poll: true` in source, unchanged.
    const source = fs.readFileSync(OPS_CONSOLE_SRC, 'utf8');
    expect(source).not.toMatch(/poll:\s*true/);
    expect(source).not.toMatch(/useAlerts\(/);
  });
});

// ─── 9 — OPEN | HISTORY ──────────────────────────────────────────────────────

describe('OPEN | HISTORY filter', () => {
  it('switches between the open working set and authoritative history', () => {
    renderPanel();

    expect(screen.getByTestId('ops-row-alert:a1')).toBeInTheDocument();
    expect(screen.getByTestId('ops-setup-toggle')).toBeInTheDocument();
    // OPEN carries no closed-alert history at all any more.
    expect(screen.queryByTestId('ops-row-recent:r1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ops-row-history:r1')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'HISTORY' }));

    // OPS-CONSOLE-HISTORY-01: HISTORY rows are now backend-classified
    // verified_resolved outcomes, so the row status is 'verified', not the
    // legacy alert-lifecycle 'closed'.
    expect(screen.getByTestId('ops-row-history:r1')).toHaveAttribute('data-status', 'verified');
    expect(screen.queryByTestId('ops-row-alert:a1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ops-setup-toggle')).not.toBeInTheDocument();

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
    // SETUP carries its own remaining count on its collapsed control.
    expect(screen.getByTestId('ops-setup-toggle')).toHaveTextContent('SETUP · 1 remaining');
  });

  // WORDING NOTE (OPS-CONSOLE-WAITING-01 correction, 2026-09-18): WAITING V1
  // now exists as a contract (see ops-console-waiting-v1-contract.test.tsx
  // and ops-console-model.test.ts's WAITING V1 block) — "absent in V1" would
  // now be misleading. This test's behavior is unchanged: no waitingItems
  // prop is passed here, and no authoritative WAITING items means no WAITING
  // section, exactly as before.
  it('renders WAITING only when the backend supplies authoritative pending items — no items means no section', () => {
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
    const loading = renderPanel({ alerts: [] });
    expect(within(loading.container).getByText('Loading setup…')).toBeInTheDocument();
    loading.unmount();

    mockUseActivationChecklist.mockReturnValue({
      items: [], completedCount: 0, allComplete: false, isLoading: false, isError: false,
    });
    const empty = renderPanel({ alerts: [] });
    expect(within(empty.container).getByText('No operational items require action.')).toBeInTheDocument();
    empty.unmount();

    mockUseActivationChecklist.mockReturnValue({
      items: [], completedCount: 0, allComplete: false, isLoading: false, isError: true,
    });
    const failed = renderPanel({ alerts: [] });
    expect(within(failed.container).getByText('Setup status unavailable.')).toBeInTheDocument();
    failed.unmount();

    // History's own states live on the HISTORY tab. OPS-CONSOLE-HISTORY-01:
    // this is now driven by useHistory(), not useAlerts({status:'resolved'}).
    mockUseHistory.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    const histFailed = renderPanel({ alerts: [] });
    fireEvent.click(screen.getByRole('tab', { name: 'HISTORY' }));
    expect(within(histFailed.container).getByText('History unavailable.')).toBeInTheDocument();
  });
});

// ─── OPS-CONSOLE-HISTORY-01 — HISTORY IS A BACKEND-CLASSIFIED VERIFIED OUTCOME
//
// SUPERSEDES the prior "alert history semantics" block (CORRECTION 1), which
// asserted the OLD alert-resolved-status contract: neutral 'closed' rows
// that must never claim verification. That contract governed
// buildAlertHistoryRows()/resolved alerts, which no longer power this tab
// (see opsConsoleModel.ts's buildHistoryRows docstring). Under HISTORY V1 a
// row here IS a canonically verified_resolved Decision Engine outcome by
// construction, so the inverse is now true: it correctly renders 'verified'.

describe('HISTORY V1 semantics — backend-classified verified outcome', () => {
  it('renders a HISTORY row with verified status, backend copy verbatim, and no local derivation', () => {
    const { container } = renderPanel();

    fireEvent.click(screen.getByRole('tab', { name: 'HISTORY' }));
    const history = screen.getByTestId('ops-row-history:r1');
    expect(history).toHaveAttribute('data-status', 'verified');
    expect(history).toHaveAttribute('data-section', 'HISTORY');
    expect(container.textContent).toMatch(/Resolved one/);

    // No HISTORY row may carry the legacy neutral alert-lifecycle status.
    expect(container.querySelectorAll('[data-section="HISTORY"][data-status="closed"]'))
      .toHaveLength(0);
  });

  // HISTORY-ORDER-ENTITY-01: HISTORY's CTA no longer navigates anywhere — it
  // opens the canonical Order Entity Modal in place (action.kind ===
  // 'order_entity'). The destination-specific proof (EntityDetailModal opens
  // for the exact order) lives in ops-console-history-v1-contract.test.tsx,
  // which mocks EntityDetailModal/OrderDetailModalBody; this file does not,
  // so it asserts only the invariant that matters here: no page navigation,
  // and certainly never to /alerts.
  it('never navigates on a HISTORY row action — order_entity opens the modal in place, not a page', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: 'HISTORY' }));

    const row = screen.getByTestId('ops-row-history:r1');
    const cta = within(row).getByRole('button');
    fireEvent.click(cta);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('renders backend-supplied HISTORY presentation copy verbatim, not derived from treatment', () => {
    mockUseHistory.mockReturnValue({
      data: {
        items: [
          historyItem({
            interventionId: 'hist-verbatim',
            presentation: {
              title: 'ZZQ-9 marker',
              subtitle: 'backend-supplied history copy #713',
              actionLabel: 'Do the resolved thing',
            },
          }),
        ],
      },
      isLoading: false, isError: false,
    });

    renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: 'HISTORY' }));

    expect(screen.getByText('ZZQ-9 marker')).toBeInTheDocument();
    expect(screen.getByText('backend-supplied history copy #713')).toBeInTheDocument();
  });
});

// ─── CORRECTION 2 — PERSISTENT CONSOLE, COMPACT COMPLETED SETUP ──────────────

describe('setup completion and dismissal', () => {
  it('keeps the console reachable after every setup item completes', () => {
    mockUseActivationChecklist.mockReturnValue({
      items: SETUP_ITEMS.map(i => ({ ...i, complete: true })),
      completedCount: 2, allComplete: true, isLoading: false, isError: false,
    });

    renderButton(<OpsConsoleButton alerts={[]} deepLink={deepLink} />);

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
    expandSetup();
    expect(screen.getByTestId('ops-row-setup:map-zones')).toHaveAttribute('data-status', 'actionable');
    // The completed one is behind a further collapse, not inline.
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

describe('HISTORY V1 rows — readability and chronology', () => {
  it('take the verified fade/quiet treatment: verified_resolved is a genuinely completed outcome', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: 'HISTORY' }));

    const row = screen.getByTestId('ops-row-history:r1');
    // OPS-CONSOLE-HISTORY-01: a HISTORY V1 row's status is 'verified' — a
    // canonically confirmed outcome, not merely an alert's own lifecycle
    // closing — so it correctly takes the SAME fade/quiet treatment as any
    // other verified row (unchanged OpsConsoleRow logic: `faded =
    // row.status === 'verified' || row.status === 'dismissed'`).
    expect(row).toHaveAttribute('data-status', 'verified');
    expect(row).toHaveStyle({ opacity: '0.62' });

    const source = fs.readFileSync(OPS_CONSOLE_SRC, 'utf8');
    expect(source).toMatch(/const faded =\s*\n?\s*row\.status === 'verified' \|\| row\.status === 'dismissed';/);
    // Label ink for a quiet row is pal.ink3, metadata is pal.ink4.
    expect(source).toMatch(/color: quiet \? pal\.ink3 : pal\.ink/);
  });

  it('shows relative resolvedAt chronology', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: 'HISTORY' }));

    const meta = screen.getByTestId('ops-row-meta-history:r1');
    expect(meta.textContent).toMatch(/^(just now|\d+m|\d+h|[A-Z][a-z]{2} \d{2})$/);
  });
});

describe('NOW rows — decluttered subject', () => {
  it('render no visible severity word', () => {
    renderPanel({ alerts: [alert({ id: 'a1', severity: 'critical' })] });

    const row = screen.getByTestId('ops-row-alert:a1');
    // The meta cell is always present so the grid columns cannot shift, but it
    // is EMPTY on an unacknowledged NOW row — severity is not printed into it.
    expect(screen.getByTestId('ops-row-meta-alert:a1').textContent).toBe('');
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
    // Screen-reader text only — never a native tooltip (see the dedicated
    // "no native tooltip" contract below).
    expect(screen.getByTestId('ops-row-alert:a1')).not.toHaveAttribute('title');

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
    renderButton(<OpsConsoleButton alerts={[alert()]} deepLink={deepLink} />);

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

    renderButton(<OpsConsoleButton alerts={[]} deepLink={deepLink} />);
    expect(document.querySelector('.MuiBadge-badge')).toHaveClass('MuiBadge-invisible');
  });

  it('hides the dot while open but keeps the authoritative count in the accessible name', () => {
    renderButton(<OpsConsoleButton alerts={[alert()]} deepLink={deepLink} />);
    const trigger = screen.getByRole('button', { name: 'Ops Console — 2 open' });
    const dot = () => screen.getByTestId('ops-console-trigger-badge').querySelector('.MuiBadge-badge');
    expect(dot()).not.toHaveClass('MuiBadge-invisible');

    fireEvent.click(trigger);

    expect(trigger).toHaveAccessibleName('Ops Console — 2 open');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(dot()).toHaveClass('MuiBadge-invisible');
  });

  it('keeps the count out of the visible trigger while the rail owns the numbers', () => {
    renderButton(<OpsConsoleButton alerts={[alert()]} deepLink={deepLink} />);
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
      sla_breach:              { route: '/orders/flow?urgency=sla_breach', label: 'Orders' },
      missing_cogs:            { route: '/inventory/costs', label: 'Costs' },
    };

    // Subset, not toEqual: the map may legitimately GAIN entries (OPS-CONSOLE-02
    // added three). What must never happen is an existing type losing or
    // silently changing its destination.
    for (const alert_type of Object.keys(EXPECTED)) {
      expect(ALERT_ROUTE_MAP[alert_type]).toEqual(EXPECTED[alert_type]);
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
        alerts={[alert({ id: 'a1', alert_type: 'inventory' })]}
        open
        onClose={jest.fn()}
      />,
    );

    fireEvent.click(within(screen.getByTestId('ops-row-alert:a1')).getByRole('button', { name: /Resolve stockouts/ }));
    expect(mockNavigate).toHaveBeenCalledWith('/orders/flow?constraint=inventory');
  });
});

// ─── /alerts PRESERVED + REACHABLE ───────────────────────────────────────────

describe('advanced alert workspace', () => {
  it('"Alert settings" is the one subtle handoff to /settings/alerts (GH-1147)', () => {
    renderPanel();

    const link = screen.getByTestId('ops-manage-alerts');
    expect(link).toHaveTextContent('Alert settings →');
    expect(link).not.toHaveTextContent('Manage alerts');
    fireEvent.click(link);
    expect(mockNavigate).toHaveBeenCalledWith('/settings/alerts');
  });

  it('adds no acknowledge/snooze/resolve/rules management of its own', () => {
    const console_ = codeOnly(fs.readFileSync(OPS_CONSOLE_SRC, 'utf8'));
    for (const control of ['acknowledge', 'useAcknowledgeAlert', 'snooze', 'useResolveAlert', 'Rules']) {
      expect(console_).not.toMatch(new RegExp(control, 'i'));
    }
    // Sanity: the stripper did not simply empty the file.
    expect(console_).toMatch(/OpsConsolePanel/);
  });

  it('keeps the /alerts wildcard route mounted for the Alerts module', () => {
    const host = fs.readFileSync(
      path.join(REPO_ROOT, 'apps/frontend/src/lifecycle/LifecycleRouteHost.tsx'), 'utf8');
    expect(host).toMatch(/<Route path="\/alerts\/\*" element=\{<AlertsPage \/>\} \/>/);
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
    // xs: CTA spans the subject columns on a second row. sm: its own column.
    for (const w of NARROW) expect(resolve(OPS_ROW_ACTION_COLUMN, w)).toBe('2 / -1');
    for (const w of [SM_BREAKPOINT, 1440]) expect(resolve(OPS_ROW_ACTION_COLUMN, w)).toBe('auto');

    const source = opsConsoleRowSource();
    // Grid, not flex-wrap, within the row itself. Unrelated modal/footer
    // layouts may legitimately wrap their own controls.
    expect(source).toMatch(/gridColumn: OPS_ROW_ACTION_COLUMN/);
    expect(source).not.toMatch(/flexWrap:/);
  });

  it('never lets the CTA shrink or wrap its label — the subject gives way instead', () => {
    const source = opsConsoleRowSource();

    // CTA: fixed size, unbreakable label.
    expect(source).toMatch(/flexShrink: 0, whiteSpace: 'nowrap'/);
    // Subject: the only column that may give way, and allowed to reach zero.
    expect(source).toMatch(/minmax\(0, 1fr\)/);
    expect(source).toMatch(/fontSize: 11\.5, minWidth: 0/);
    expect(source).toMatch(/overflowWrap: 'anywhere'/);
    // No positive numeric min-width inside OpsConsoleRow may force horizontal overflow.
    const widths = [...source.matchAll(/\bmin[Ww]idth: (\d+)/g)].map(m => Number(m[1]));
    expect(widths.filter(n => n > 0)).toEqual([]);
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
    expect(mockNavigate).toHaveBeenCalledWith('/orders/flow?urgency=sla_breach');
  });

  it('keeps a long subject complete in the DOM so wrapping, not clipping, applies', () => {
    const LONG = 'Variant 4450 out of stock at the Rotterdam fulfilment centre and blocked';
    renderPanel({ alerts: [alert({ id: 'a1', title: LONG })] });

    expect(screen.getByTestId('ops-row-label-alert:a1').textContent).toBe(LONG);
  });

  it('keeps header, tabs, close control, section counts and Alert settings present', () => {
    renderPanel({ alerts: [alert({ id: 'a1' })] });

    expect(screen.getByLabelText('Ops Console')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close Ops Console' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'OPEN' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'HISTORY' })).toBeInTheDocument();
    expect(screen.getByTestId('ops-manage-alerts')).toBeInTheDocument();

    // Section labels and their counts both survive the narrow layout.
    const texts = Array.from(document.querySelectorAll('div')).map(el => el.textContent ?? '');
    expect(texts.some(t => t.startsWith('NOW') && t.endsWith('1'))).toBe(true);
    expect(screen.getByTestId('ops-setup-toggle')).toHaveTextContent('SETUP · 1 remaining');
  });

  it('adds no oversized padding to buy the reflow', () => {
    const source = fs.readFileSync(OPS_CONSOLE_SRC, 'utf8');
    // Compact grid gaps, and the flat (non-card) row keeps the approved
    // desktop padding.
    expect(source).toMatch(/rowGap: '3px'/);
    expect(source).toMatch(/columnGap: '6px'/);
    expect(source).toMatch(/px: 1\.5, py: 0\.75,/);
  });
});

// ─── OPS-CONSOLE-02 — ACTION-FIRST INFORMATION ARCHITECTURE ──────────────────

describe('OPEN is actionable work only', () => {
  it('renders NOW and SETUP and no closed-alert history whatsoever', () => {
    const { container } = renderPanel();

    expect(container.textContent).toMatch(/NOW/);
    expect(screen.getByTestId('ops-setup-toggle')).toBeInTheDocument();

    // No RECENT section, no closed rows, no history row ids in OPEN.
    expect(container.textContent).not.toMatch(/RECENT/);
    expect(container.querySelectorAll('[data-status="closed"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-section="HISTORY"]')).toHaveLength(0);
  });

  it('puts operational NOW above SETUP', () => {
    const { container } = renderPanel({ alerts: [alert({ id: 'a1' })] });

    const nowRow = screen.getByTestId('ops-row-alert:a1');
    const setup = screen.getByTestId('ops-setup-toggle');
    expect(nowRow.compareDocumentPosition(setup) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(container.textContent!.indexOf('NOW'))
      .toBeLessThan(container.textContent!.indexOf('SETUP'));
  });

  it('manufactures no WAITING section', () => {
    const { container } = renderPanel();
    expect(container.textContent).not.toMatch(/WAITING/);
    expect(container.querySelectorAll('[data-status="waiting"]')).toHaveLength(0);
  });
});

describe('HISTORY tab', () => {
  it('is the only home for backend-classified verified-resolved episodes, and carries the ✓ glyph', () => {
    const { container } = renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: 'HISTORY' }));

    const row = screen.getByTestId('ops-row-history:r1');
    // OPS-CONSOLE-HISTORY-01: a HISTORY V1 row IS a canonically verified
    // outcome, so it correctly carries 'verified' status and the ✓ glyph —
    // the inverse of the retired alert-lifecycle 'closed'/neutral contract.
    expect(row).toHaveAttribute('data-status', 'verified');
    expect(row).toHaveTextContent('✓');
    expect(container.textContent).toMatch(/HISTORY/);
  });
});

describe('NOW is actionable-only', () => {
  it('drops dead-end alerts from the queue without inventing a generic CTA', () => {
    renderPanel({
      alerts: [
        alert({ id: 'a1', alert_type: 'sla_breach' }),
        alert({ id: 'a2', alert_type: 'totally_unmapped' }),
      ],
      deepLink: alertDeepLink,
    });

    expect(screen.getByTestId('ops-row-alert:a1')).toBeInTheDocument();
    expect(screen.queryByTestId('ops-row-alert:a2')).not.toBeInTheDocument();

    // No generic fallback CTA was synthesised on any ROW to keep the dead-end
    // alert in the queue. (The rail's own "Alert settings →" footer is a
    // different thing and must still be there — asserted below.)
    const rowCtas = Array.from(document.querySelectorAll('[data-testid^="ops-row-action-wrap-"]'))
      .map(el => el.textContent ?? '');
    expect(rowCtas).toEqual(['Orders →']);
    for (const generic of ['View', 'Manage alert', 'Details']) {
      expect(rowCtas.some(t => t.includes(generic))).toBe(false);
    }

    // The rail's Alert settings footer is still present.
    expect(screen.getByTestId('ops-manage-alerts')).toBeInTheDocument();
  });
});

describe('the three fixed dead-end alert families', () => {
  const CASES = [
    { alert_type: 'inventory',         label: 'Resolve stockouts', route: '/orders/flow?constraint=inventory' },
    { alert_type: 'customer',          label: 'Fix addresses', route: '/overview?resolution=address' },
    { alert_type: 'low_stock_reorder', label: 'Reorder now',   route: '/demand?filter=critical' },
  ];

  it.each(CASES)('$alert_type -> $label -> $route', ({ alert_type, label, route }) => {
    expect(alertDeepLink(alert({ alert_type }))).toEqual({ route, label });

    render(
      <OpsConsolePanel
        alerts={[alert({ id: 'a1', alert_type })]}
        open
        onClose={jest.fn()}
      />,
    );

    const cta = within(screen.getByTestId('ops-row-alert:a1')).getByRole('button');
    expect(cta.textContent).toBe(`${label} →`);
    fireEvent.click(cta);
    expect(mockNavigate).toHaveBeenCalledWith(route);
  });

  it('does not pretend the aggregate inventory alert has targeted Sourcing context', () => {
    // The shop-level aggregate carries no variant/order: entity_type='shop',
    // entity_id=null. It must land on the constrained-order list, never on a
    // variant-scoped Sourcing deep link.
    const aggregate = alert({
      alert_type: 'inventory', entity_type: 'shop', entity_id: null,
    });
    const link = alertDeepLink(aggregate)!;

    expect(link.route).toBe('/orders/flow?constraint=inventory');
    expect(link.route).not.toMatch(/sourcing/i);
    expect(link.route).not.toMatch(/variantId/);
    expect(link.route).not.toMatch(/catalog/i);
    // The label names the resolution job, not a stock report.
    expect(link.label).toBe('Resolve stockouts');
  });

  it('keeps inventory, low_stock_reorder and stockout_risk as three distinct states', () => {
    const routes = ['inventory', 'low_stock_reorder', 'stockout_risk']
      .map(t => ALERT_ROUTE_MAP[t]);

    expect(routes.every(Boolean)).toBe(true);
    // inventory is order-blocking; the other two are demand-side.
    expect(ALERT_ROUTE_MAP.inventory.route).not.toBe(ALERT_ROUTE_MAP.low_stock_reorder.route);
    // Separate map entries, so the two demand signals can diverge later.
    expect(ALERT_ROUTE_MAP.low_stock_reorder).not.toBe(ALERT_ROUTE_MAP.stockout_risk);
    expect(ALERT_ROUTE_MAP.low_stock_reorder.label).toBe('Reorder now');
    expect(ALERT_ROUTE_MAP.stockout_risk.label).toBe('Sourcing');
  });
});

describe('NOW cap of five', () => {
  const nine = Array.from({ length: 9 }, (_, i) =>
    alert({ id: `a${i}`, title: `Actionable ${i}` }));

  it('counts every actionable row while rendering only the first five', () => {
    const { container } = renderPanel({ alerts: nine });

    expect(container.querySelectorAll('[data-section="NOW"]')).toHaveLength(5);
    // The header count is the full workload, including capped-away rows.
    const texts = Array.from(container.querySelectorAll('div')).map(el => el.textContent ?? '');
    expect(texts.some(t => t.startsWith('NOW') && t.endsWith('9'))).toBe(true);
  });

  it('preserves the backend input order — no client-side re-sorting', () => {
    const { container } = renderPanel({ alerts: nine });

    const ids = Array.from(container.querySelectorAll('[data-section="NOW"]'))
      .map(el => el.getAttribute('data-testid'));
    expect(ids).toEqual([
      'ops-row-alert:a0', 'ops-row-alert:a1', 'ops-row-alert:a2',
      'ops-row-alert:a3', 'ops-row-alert:a4',
    ]);

    const source = fs.readFileSync(OPS_CONSOLE_SRC, 'utf8');
    expect(source).not.toMatch(/\.sort\(/);
  });

  it('"Show N more" reveals the remainder and "Show less" restores the queue', () => {
    const { container } = renderPanel({ alerts: nine });

    const more = screen.getByTestId('ops-now-show-more');
    expect(more).toHaveTextContent('Show 4 more');

    fireEvent.click(more);
    expect(container.querySelectorAll('[data-section="NOW"]')).toHaveLength(9);
    expect(screen.queryByTestId('ops-now-show-more')).not.toBeInTheDocument();

    // Order still untouched after expanding.
    const ids = Array.from(container.querySelectorAll('[data-section="NOW"]'))
      .map(el => el.getAttribute('data-testid'));
    expect(ids).toEqual(nine.map(a => `ops-row-alert:${a.id}`));

    fireEvent.click(screen.getByTestId('ops-now-show-less'));
    expect(container.querySelectorAll('[data-section="NOW"]')).toHaveLength(5);
    expect(screen.getByTestId('ops-now-show-more')).toHaveTextContent('Show 4 more');
  });

  it('shows no cap control at or below five actionable rows', () => {
    const five = Array.from({ length: 5 }, (_, i) => alert({ id: `a${i}` }));
    const { container } = renderPanel({ alerts: five });

    expect(container.querySelectorAll('[data-section="NOW"]')).toHaveLength(5);
    expect(screen.queryByTestId('ops-now-show-more')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ops-now-show-less')).not.toBeInTheDocument();
  });

  it('adds no pagination controls', () => {
    renderPanel({ alerts: nine });
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByText(/next|previous|page \d/i)).not.toBeInTheDocument();
  });
});

describe('SETUP is secondary and collapsed', () => {
  it('is collapsed by default with its own remaining count, exposing no task rows', () => {
    const { container } = renderPanel();

    const toggle = screen.getByTestId('ops-setup-toggle');
    expect(toggle).toHaveTextContent('SETUP · 1 remaining');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelectorAll('[data-section="SETUP"]')).toHaveLength(0);
  });

  it('expands accessibly and exposes incomplete tasks with their real routes', () => {
    renderPanel();
    const toggle = screen.getByTestId('ops-setup-toggle');

    // Keyboard-activatable: it is a real button with aria-expanded state.
    expect(toggle.tagName).toBe('BUTTON');
    fireEvent.click(toggle);
    expect(screen.getByTestId('ops-setup-toggle')).toHaveAttribute('aria-expanded', 'true');

    const row = screen.getByTestId('ops-row-setup:map-zones');
    fireEvent.click(within(row).getByRole('button', { name: /Open/ }));
    expect(mockNavigate).toHaveBeenCalledWith('/floor-planning?tab=setup&view=canvas');
  });

  it('never renders completed setup as individual rows competing with open work', () => {
    const { container } = renderPanel();
    expandSetup();

    // Only the one incomplete task is a row; the completed one stays behind
    // its own collapse.
    expect(container.querySelectorAll('[data-section="SETUP"]')).toHaveLength(1);
    expect(screen.queryByTestId('ops-row-setup:connect-store')).not.toBeInTheDocument();
    expect(screen.getByTestId('ops-setup-completed-toggle')).toHaveTextContent('1 completed');
  });

  it('stays compact when everything is complete', () => {
    mockUseActivationChecklist.mockReturnValue({
      items: SETUP_ITEMS.map(i => ({ ...i, complete: true })),
      completedCount: 2, allComplete: true, isLoading: false, isError: false,
    });
    const { container } = renderPanel({ alerts: [] });

    expect(screen.getByTestId('ops-setup-complete')).toHaveTextContent('Setup complete · 2/2');
    expect(container.querySelectorAll('[data-section="SETUP"]')).toHaveLength(0);
    expect(screen.queryByTestId('ops-setup-toggle')).not.toBeInTheDocument();
  });
});

describe('severity is semantics, not copy', () => {
  it('renders no severity word and no native tooltip anywhere in the rail', () => {
    const { container } = renderPanel({
      alerts: [
        alert({ id: 'a1', severity: 'critical', title: 'Blocked orders' }),
        alert({ id: 'a2', severity: 'warning', title: 'Late orders' }),
      ],
    });

    // No row (or any element) carries a title attribute — a native tooltip is
    // exactly how "warning severity" became visible on hover.
    expect(container.querySelectorAll('[title]')).toHaveLength(0);

    // Visible text carries none of the severity vocabulary.
    const visible = Array.from(container.querySelectorAll('[data-testid^="ops-row-label-"], [data-testid^="ops-row-meta-"]'))
      .map(el => el.textContent ?? '').join(' ').toLowerCase();
    for (const word of ['warning', 'critical', 'severity']) {
      expect(visible).not.toContain(word);
    }
  });

  it('keeps severity available to assistive tech and to the glyph tone', () => {
    renderPanel({
      alerts: [
        alert({ id: 'a1', severity: 'critical' }),
        alert({ id: 'a2', severity: 'warning', title: 'Second' }),
      ],
    });

    expect(screen.getByTestId('ops-row-sr-alert:a1')).toHaveTextContent('critical severity');
    expect(screen.getByTestId('ops-row-sr-alert:a2')).toHaveTextContent('warning severity');

    const source = fs.readFileSync(OPS_CONSOLE_SRC, 'utf8');
    expect(source).toMatch(/var\(--critical-ink\)/);
    expect(source).toMatch(/var\(--warning-ink\)/);
  });
});

describe('bottom-scroll structure', () => {
  // Structural regression only. jsdom does not lay out or scroll, so this
  // asserts the single-scroll-container invariant that the defect violated —
  // it does NOT prove scroll geometry. Browser verification stays required.
  it('has exactly one scroll container: the body, never the panel', () => {
    renderPanel();

    expect(screen.getByTestId('ops-console-body')).toBeInTheDocument();

    const source = fs.readFileSync(OPS_CONSOLE_SRC, 'utf8');
    // The panel must not set a single-axis overflow: per CSS overflow, when one
    // axis is not `visible` the other's `visible` computes to `auto`, which
    // silently made the panel a second, nested scroll container.
    expect(source).not.toMatch(/overflowX: 'hidden',\n\s*display: 'flex', flexDirection: 'column'/);
    expect(source).toMatch(/overflow: 'hidden',\n\s*display: 'flex', flexDirection: 'column'/);
    // The body is the scroller and can actually shrink in the flex column.
    expect(source).toMatch(/flex: '1 1 auto', minHeight: 0, overflowY: 'auto'/);
  });

  it('scopes each row\'s hidden severity node to its own row', () => {
    renderPanel({ alerts: [alert({ id: 'a1' })] });

    const row = screen.getByTestId('ops-row-alert:a1');
    // The sr-only node is absolutely positioned; without position:relative on
    // the row its containing block was the panel, so it was laid out against
    // the panel and fed the panel's overflow instead of the row's.
    expect(row.contains(screen.getByTestId('ops-row-sr-alert:a1'))).toBe(true);
    const source = fs.readFileSync(OPS_CONSOLE_SRC, 'utf8');
    expect(source).toMatch(/position: 'relative',\n\s*display: 'grid',/);
  });
});

// ─── DETERMINISTIC GRID + COMPACT MICRO-CARDS ────────────────────────────────

describe('deterministic row layout', () => {
  const src = opsConsoleRowSource;

  it('uses grid with an explicit column track list, not nowrap flex', () => {
    const source = src();

    expect(source).toMatch(/display: 'grid',/);
    expect(source).toMatch(/gridTemplateColumns: \{\s*\n\s*xs: '10px minmax\(0, 1fr\) auto',\s*\n\s*sm: '10px minmax\(0, 1fr\) auto auto',/);
    // The flex anatomy that allowed subject/CTA collision is gone from the row.
    expect(source).not.toMatch(/flexWrap:/);
    // Layout is not solved with absolute positioning — the only absolute node
    // is the off-screen sr-only span.
    expect(source.match(/position: 'absolute'/g)).toHaveLength(1);
  });

  it('gives the subject minmax(0,1fr) and the CTA an intrinsic auto column', () => {
    const source = src();

    expect(source).toMatch(/minmax\(0, 1fr\) auto auto/);   // subject flexible, meta + CTA intrinsic
    expect(source).toMatch(/fontSize: 11\.5, minWidth: 0/);   // subject may reach zero
    expect(source).toMatch(/flexShrink: 0, whiteSpace: 'nowrap'/); // CTA never shrinks or wraps
    const widths = [...source.matchAll(/\bmin[Ww]idth: (\d+)/g)]
      .map((match) => Number(match[1]));
    expect(widths.filter((width) => width > 0)).toEqual([]);
    expect(OPS_ROW_ACTION_COLUMN.sm).toBe('auto');
  });

  it('always renders the meta cell so columns cannot shift the CTA sideways', () => {
    renderPanel({ alerts: [alert({ id: 'a1' })] });

    // Present but empty — a missing cell would let the CTA slide into col 3.
    const meta = screen.getByTestId('ops-row-meta-alert:a1');
    expect(meta).toBeInTheDocument();
    expect(meta.textContent).toBe('');
  });

  it('keeps a long subject in its own column, never beneath the CTA', () => {
    const LONG = 'Variant 4450 out of stock at the Rotterdam fulfilment centre and blocking 12 orders';
    renderPanel({ alerts: [alert({ id: 'a1', title: LONG })] });

    const row = screen.getByTestId('ops-row-alert:a1');
    const label = screen.getByTestId('ops-row-label-alert:a1');
    const ctaWrap = screen.getByTestId('ops-row-action-wrap-alert:a1');

    // Both are ordinary in-flow grid children of the same row — separate cells,
    // so overlap is structurally impossible rather than merely unlikely.
    expect(label.parentElement).toBe(row);
    expect(ctaWrap.parentElement).toBe(row);
    expect(label.textContent).toBe(LONG);
    // Subject precedes the CTA in document order; neither is positioned.
    expect(label.compareDocumentPosition(ctaWrap) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });
});

describe('compact micro-cards', () => {
  const src = () => fs.readFileSync(OPS_CONSOLE_SRC, 'utf8');

  it('cardizes actionable NOW rows', () => {
    renderPanel({ alerts: [alert({ id: 'a1' })] });
    expect(screen.getByTestId('ops-row-alert:a1')).toHaveAttribute('data-card', 'true');
  });

  it('uses the same compact treatment for expanded incomplete SETUP rows', () => {
    renderPanel();
    expandSetup();
    expect(screen.getByTestId('ops-row-setup:map-zones')).toHaveAttribute('data-card', 'true');
  });

  it('leaves HISTORY flat and quiet — no card, no elevation', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: 'HISTORY' }));

    expect(screen.getByTestId('ops-row-history:r1')).toHaveAttribute('data-card', 'false');
    // Cardization is gated on being actionable AND not HISTORY.
    expect(src()).toMatch(/const isCard = row\.section !== 'HISTORY' && Boolean\(row\.action\);/);
  });

  it('stays compact: intrinsic height, no minHeight, small padding and gaps', () => {
    const source = src();

    // Intrinsic height — nothing forces a dashboard-card proportion. The only
    // permitted minHeight in the file is the body's `minHeight: 0`, which is
    // the flex-shrink fix for the scroll container, not a card dimension.
    const minHeights = [...codeOnly(source).matchAll(/minHeight: ([^,\s}]+)/g)].map(m => m[1]);
    expect(minHeights).toEqual(['0']);
    expect(source).toMatch(/px: '7px', py: '4px'/);      // 7px / 4px
    expect(source).toMatch(/mx: '7px', my: '3px'/);      // 3px inter-card gap
    expect(source).toMatch(/columnGap: '6px'/);
    expect(source).toMatch(/rowGap: '3px'/);
    expect(source).toMatch(/borderRadius: '6px'/);
    // No card header/body/footer anatomy.
    expect(source).not.toMatch(/CardHeader|CardContent|CardActions/);
  });

  it('borders and elevates from existing theme tokens only — no hardcoded colour', () => {
    const source = src();

    expect(source).toMatch(/border: `0\.5px solid \$\{pal\.rule\}`/);
    expect(source).toMatch(/boxShadow: pal\.shadow,/);
    expect(source).toMatch(/boxShadow: pal\.shadowMd,/);
    expect(source).toMatch(/borderColor: pal\.rule2,/);
    // Still no literal colours anywhere in the component.
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\brgba?\(/);
  });

  it('keeps the CTA compact and does not make the card itself clickable', () => {
    renderPanel({ alerts: [alert({ id: 'a1' })] });

    const row = screen.getByTestId('ops-row-alert:a1');
    // The card is a plain Box: no click handler, no button role, not focusable.
    expect(row.tagName).toBe('DIV');
    expect(row).not.toHaveAttribute('role', 'button');
    expect(row).not.toHaveAttribute('tabindex');
    expect(row).not.toHaveAttribute('onclick');

    // Navigating requires the explicit CTA.
    fireEvent.click(row);
    expect(mockNavigate).not.toHaveBeenCalled();

    fireEvent.click(within(row).getByRole('button'));
    expect(mockNavigate).toHaveBeenCalledWith('/problem-center');

    // CTA is a small pill, not an oversized button.
    expect(src()).toMatch(/px: '6px', py: '1px'/);
  });
});

describe('micro-interaction', () => {
  const src = () => fs.readFileSync(OPS_CONSOLE_SRC, 'utf8');

  it('lifts by at most 1px on hover, with no bounce/scale/glow/colour flood', () => {
    const source = src();

    expect(source).toMatch(/transform: 'translateY\(-1px\)'/);
    // No larger translate, no scaling, no glow.
    expect(source).not.toMatch(/translateY\(-(?!1px)\d+px\)/);
    expect(source).not.toMatch(/scale\(/);
    expect(source).not.toMatch(/cubic-bezier/);      // no bounce curve
    expect(source).not.toMatch(/filter:|drop-shadow/);
  });

  it('settles back ~1px only while the real CTA is pressed', () => {
    const source = src();
    // Scoped to the button's :active — the card never claims its own press.
    expect(source).toMatch(/'&:has\(button:active\)': \{ transform: 'translateY\(0\)' \}/);
  });

  it('transitions transform/shadow/border only, in the 120-160ms band', () => {
    const source = src();

    expect(source).toMatch(/transition: 'transform 140ms ease-out, box-shadow 140ms ease-out, border-color 140ms ease-out'/);
    // Never `all`, which would animate colour and layout too.
    expect(source).not.toMatch(/transition: 'all/);

    const durations = [...source.matchAll(/(\d+)ms/g)].map(m => Number(m[1]));
    expect(durations.length).toBeGreaterThan(0);
    for (const d of durations) {
      expect(d).toBeGreaterThanOrEqual(120);
      expect(d).toBeLessThanOrEqual(160);
    }
  });

  it('drops the transform animation under prefers-reduced-motion, keeping the cue', () => {
    const source = src();

    expect(source).toMatch(/'@media \(prefers-reduced-motion: reduce\)': \{/);
    // Reduced motion: transform removed from both the transition and the states,
    // but border/shadow feedback is retained so hover is still perceivable.
    expect(source).toMatch(/transition: 'box-shadow 140ms ease-out, border-color 140ms ease-out'/);
    expect(source).toMatch(/transform: 'none'/);
  });
});

describe('no outcome semantics were introduced', () => {
  it('adds no WAITING, verified or intervention vocabulary alongside the cards', () => {
    const { container } = renderPanel({ alerts: [alert({ id: 'a1' })] });

    expect(container.textContent).not.toMatch(/WAITING/);
    expect(container.querySelectorAll('[data-status="waiting"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-section="NOW"][data-status="verified"]'))
      .toHaveLength(0);

    const text = (container.textContent ?? '').toLowerCase();
    for (const word of ['intervention', 'prevented', 'verified outcome']) {
      expect(text).not.toContain(word);
    }
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

// ─── GH-1156 — SETUP OPENING INVENTORY COMMAND ───────────────────────────────

describe('SETUP Opening Inventory command (GH-1156)', () => {
  const START_URL = '/api/v1/wms/opening-inventory/start';
  const RECOUNT_ASSIGNEES_URL = '/api/v1/operators/recount-assignees';
  // The canonical lifecycle mapping, not a hand-written row: the surface is
  // exercised with exactly what the hook derives from canonical progress.
  const { buildOpeningInventoryItem } = jest.requireActual('hooks/useActivationChecklist');
  const view = (state: string, over: Record<string, unknown> = {}) => ({
    progress: { state, total_bins: 17, complete_bins: 6 },
    cutover: null,
    shopify_synced_at: null,
    ...over,
  });
  // #1164 — canonical ShopOpeningInventoryProgress bins, in server order.
  const bin = (id: string, over: Record<string, unknown> = {}) => ({
    recount_task_id: id, warehouse_id: 'wh-1', location_code: `BIN-${id}`,
    status: 'dispatched', progress_state: 'not_started',
    assigned_to: 7, claimed_by: null, ...over,
  });
  const countingView = () => view('counting', {
    progress: {
      state: 'counting', total_bins: 17, complete_bins: 6,
      bins: [bin('t-1', { status: 'committed', progress_state: 'complete' }), bin('t-2'), bin('t-3')],
    },
  });
  /** The start endpoint returns ShopOpeningInventoryProgress (flat, not the cutover view). */
  const startedProgress = (bins: unknown[]) => ({
    data: { state: 'counting', total_bins: bins.length, complete_bins: 0, bins },
  });

  let refresh: jest.Mock;
  let getSpy: jest.SpyInstance;
  let postSpy: jest.SpyInstance;

  // canStart mirrors the hook's advisory owner/admin gate.
  function withOpeningItem(
    progressView: unknown,
    canStart = true,
    currentUserId = 7
  ) {
    mockUseActivationChecklist.mockReturnValue({
      items: [
        ...SETUP_ITEMS,
        buildOpeningInventoryItem(
          false,
          progressView,
          canStart,
          currentUserId
        ),
      ],
      completedCount: 1, allComplete: false, isLoading: false, isError: false,
      refreshOpeningInventory: refresh,
      currentUserId,
    });
  }

  const openingRow = () => screen.getByTestId('ops-row-setup:opening-inventory');
  const startButton = () => within(openingRow()).getByRole('button');
  const postCount = () => postSpy.mock.calls.filter(([url]) => url === START_URL).length;
  const modal = () => screen.getByTestId('entity-detail-modal');
  // GH-1164 — one combined modal: operator discovery, selection and the only
  // mutating CTA (Create opening count). There is no Start-counting step.
  const openingModal = () => screen.findByLabelText('Start opening inventory count');

  beforeEach(() => {
    refresh = jest.fn().mockResolvedValue(undefined);
    getSpy = jest.spyOn(axiosInstance, 'get');
    postSpy = jest.spyOn(axiosInstance, 'post');
  });

  afterEach(() => {
    getSpy.mockRestore();
    postSpy.mockRestore();
  });

  it('not_started: Start opening count opens the explanation modal and does NOT POST', () => {
    getSpy.mockImplementationOnce(() => new Promise(() => undefined));
    withOpeningItem(view('not_started', { progress: { state: 'not_started', total_bins: 0, complete_bins: 0 } }));
    renderPanel();
    expandSetup();

    expect(openingRow()).toHaveTextContent('Establish opening inventory');
    expect(openingRow()).not.toHaveTextContent(/reconcile/i);
    expect(startButton()).toHaveTextContent(/^Start opening count$/);
    expect(screen.queryByTestId('entity-detail-modal')).toBeNull();

    fireEvent.click(startButton());

    expect(modal()).toHaveAttribute('aria-label', 'Start opening inventory count');
    expect(getSpy).toHaveBeenCalledWith(RECOUNT_ASSIGNEES_URL);
    expect(within(modal()).getByRole('button', { name: 'Loading operators…' })).toBeDisabled();
    expect(postCount()).toBe(0);
    expect(refresh).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('Cancel stays enabled during operator discovery and late success cannot restore dismissed state', async () => {
    let resolveGet!: (value: unknown) => void;
    getSpy.mockImplementationOnce(() => new Promise((resolve) => { resolveGet = resolve; }));
    getSpy.mockImplementationOnce(() => new Promise(() => undefined));
    withOpeningItem(view('not_started'));
    renderPanel();
    expandSetup();

    fireEvent.click(startButton());
    expect(modal()).toBeInTheDocument();
    expect(getSpy).toHaveBeenCalledWith(RECOUNT_ASSIGNEES_URL);
    const cancel = within(modal()).getByRole('button', { name: 'Cancel' });
    expect(cancel).toBeEnabled();
    fireEvent.click(cancel);
    expect(screen.queryByTestId('entity-detail-modal')).toBeNull();

    await act(async () => {
      resolveGet({ data: { operators: [{ user_id: 7, first_name: 'Stale', last_name: 'Owner' }] } });
    });
    expect(screen.queryByTestId('entity-detail-modal')).toBeNull();
    fireEvent.click(startButton());
    expect(getSpy).toHaveBeenCalledTimes(2);
    expect(within(modal()).queryByRole('radio')).toBeNull();
    expect(within(modal()).getByRole('button', { name: 'Loading operators…' })).toBeDisabled();
    expect(postCount()).toBe(0);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('reopened discovery keeps the second response and selection when the first success arrives late', async () => {
    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    getSpy.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    getSpy.mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    withOpeningItem(view('not_started'));
    renderPanel();
    expandSetup();
    fireEvent.click(startButton());
    fireEvent.click(within(modal()).getByRole('button', { name: 'Dismiss modal' }));
    expect(screen.queryByTestId('entity-detail-modal')).toBeNull();
    fireEvent.click(startButton());
    expect(getSpy).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolveSecond({ data: { operators: [{ user_id: 8, first_name: 'Current', last_name: 'Operator' }] } });
    });
    const current = within(modal()).getByRole('radio', { name: /Current Operator/ });
    fireEvent.click(current);
    expect(current).toHaveAttribute('aria-checked', 'true');
    await act(async () => {
      resolveFirst({ data: { operators: [{ user_id: 7, first_name: 'Stale', last_name: 'Owner' }] } });
    });
    expect(within(modal()).getByRole('radio', { name: /Current Operator/ })).toHaveAttribute('aria-checked', 'true');
    expect(within(modal()).queryByRole('radio', { name: /Stale Owner/ })).toBeNull();
    expect(within(modal()).queryByRole('alert')).toBeNull();
    expect(postCount()).toBe(0);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('late failed discovery cannot inject an error or clear loading in a newer session', async () => {
    let rejectFirst!: (reason: Error) => void;
    let resolveSecond!: (value: unknown) => void;
    getSpy.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }));
    getSpy.mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    withOpeningItem(view('not_started'));
    renderPanel();
    expandSetup();
    fireEvent.click(startButton());
    fireEvent.click(within(modal()).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(startButton());
    await act(async () => { rejectFirst(new Error('Old discovery failed')); });
    expect(getSpy).toHaveBeenCalledTimes(2);
    expect(within(modal()).queryByRole('alert')).toBeNull();
    expect(within(modal()).getByRole('button', { name: 'Loading operators…' })).toBeDisabled();
    await act(async () => {
      resolveSecond({ data: { operators: [{ user_id: 8, first_name: 'Current', last_name: 'Operator' }] } });
    });
    expect(within(modal()).getByRole('radio', { name: /Current Operator/ })).toBeInTheDocument();
    expect(within(modal()).queryByRole('alert')).toBeNull();
    expect(postCount()).toBe(0);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // #1164 — automatic discovery runs at most once per modal session: an empty
  // or failed result is terminal until the modal is closed and reopened.
  const discoveryGets = () =>
    getSpy.mock.calls.filter(([url]) => url === RECOUNT_ASSIGNEES_URL).length;
  const settle = async () => {
    for (let i = 0; i < 5; i += 1) {
      await act(async () => { await Promise.resolve(); });
    }
  };

  it('an empty discovery result is terminal: exactly one GET while the modal stays open', async () => {
    getSpy.mockResolvedValue({ data: { operators: [] } });
    withOpeningItem(view('not_started'));
    renderPanel();
    expandSetup();
    fireEvent.click(startButton());

    expect(await within(modal()).findByText('No eligible warehouse operator is available for this count.'))
      .toBeInTheDocument();
    await settle();

    expect(discoveryGets()).toBe(1);
    expect(within(modal()).getByText('No eligible warehouse operator is available for this count.'))
      .toBeInTheDocument();
    expect(postCount()).toBe(0);
  });

  it('a failed discovery is terminal: exactly one GET while the modal stays open', async () => {
    getSpy.mockRejectedValue(new Error('Discovery unavailable'));
    withOpeningItem(view('not_started'));
    renderPanel();
    expandSetup();
    fireEvent.click(startButton());

    expect(await within(modal()).findByText('Could not load eligible warehouse operators. Try again.'))
      .toBeInTheDocument();
    await settle();

    expect(discoveryGets()).toBe(1);
    expect(within(modal()).getByText('Could not load eligible warehouse operators. Try again.'))
      .toBeInTheDocument();
    expect(postCount()).toBe(0);
  });

  it('closing and reopening the modal starts a new session with exactly one new discovery', async () => {
    getSpy.mockResolvedValue({ data: { operators: [] } });
    withOpeningItem(view('not_started'));
    renderPanel();
    expandSetup();
    fireEvent.click(startButton());
    await within(modal()).findByText('No eligible warehouse operator is available for this count.');
    await settle();
    expect(discoveryGets()).toBe(1);

    fireEvent.click(within(modal()).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('entity-detail-modal')).toBeNull();
    fireEvent.click(startButton());
    await within(modal()).findByText('No eligible warehouse operator is available for this count.');
    await settle();

    expect(discoveryGets()).toBe(2);
    expect(postCount()).toBe(0);
  });

  // #1164 — no operator is ever preselected, not even when the only eligible
  // assignee is the current user. Create stays disabled until an explicit choice.
  const createButton = () =>
    within(modal()).getByRole('button', { name: 'Create opening count' });

  it('single self assignee: radio starts unchecked and Create stays disabled until explicitly clicked', async () => {
    getSpy.mockResolvedValueOnce({
      data: { operators: [{ user_id: 42, role: 'owner' }] },
    });
    withOpeningItem(view('not_started'), true, 42);
    renderPanel();
    expandSetup();
    fireEvent.click(startButton());

    const self = await within(modal()).findByRole('radio', { name: /User 42.*Me/ });
    expect(self).toHaveAttribute('aria-checked', 'false');
    expect(createButton()).toBeDisabled();

    fireEvent.click(self);

    expect(self).toHaveAttribute('aria-checked', 'true');
    expect(createButton()).toBeEnabled();
    expect(postCount()).toBe(0);
  });

  it('cancel and reopen clears the previous explicit selection', async () => {
    getSpy.mockResolvedValue({
      data: { operators: [{ user_id: 42, role: 'owner' }] },
    });
    withOpeningItem(view('not_started'), true, 42);
    renderPanel();
    expandSetup();
    fireEvent.click(startButton());

    fireEvent.click(await within(modal()).findByRole('radio', { name: /User 42.*Me/ }));
    expect(createButton()).toBeEnabled();

    fireEvent.click(within(modal()).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('entity-detail-modal')).toBeNull();
    fireEvent.click(startButton());

    const self = await within(modal()).findByRole('radio', { name: /User 42.*Me/ });
    expect(self).toHaveAttribute('aria-checked', 'false');
    expect(createButton()).toBeDisabled();
    expect(postCount()).toBe(0);
  });

  it('multiple assignees: none preselected; an explicitly chosen operator enables Create', async () => {
    getSpy.mockResolvedValueOnce({
      data: {
        operators: [
          { user_id: 7, first_name: 'Mabu', last_name: 'Owner', role: 'owner' },
          { user_id: 8, first_name: 'Alex', last_name: 'Operator', role: 'operator' },
        ],
      },
    });
    withOpeningItem(view('not_started'), true, 7);
    renderPanel();
    expandSetup();
    fireEvent.click(startButton());

    const self = await within(modal()).findByRole('radio', { name: /Mabu Owner.*Me/ });
    const alex = within(modal()).getByRole('radio', { name: /Alex Operator/ });
    expect(self).toHaveAttribute('aria-checked', 'false');
    expect(alex).toHaveAttribute('aria-checked', 'false');
    expect(createButton()).toBeDisabled();

    fireEvent.click(alex);

    expect(alex).toHaveAttribute('aria-checked', 'true');
    expect(self).toHaveAttribute('aria-checked', 'false');
    expect(createButton()).toBeEnabled();
    expect(postCount()).toBe(0);
  });

  it('Start opening count discovers operators inside the combined modal and does not create work before Create opening count', async () => {
    getSpy.mockResolvedValueOnce({
      data: {
        operators: [
          { user_id: 7, first_name: 'Mabu', last_name: 'Owner', role: 'owner' },
          { user_id: 8, first_name: 'Alex', last_name: 'Operator', role: 'operator' },
        ],
      },
    });
    // Prevent the CURRENT stale direct-POST behavior from escaping to a real request
    // while this test is RED.
    postSpy.mockResolvedValue(startedProgress([]));

    withOpeningItem(view('not_started'), true, 7);
    renderPanel();
    expandSetup();

    fireEvent.click(startButton());

    await waitFor(() =>
      expect(getSpy).toHaveBeenCalledWith(RECOUNT_ASSIGNEES_URL)
    );

    expect(modal()).toHaveAttribute('aria-label', 'Start opening inventory count');
    expect(await within(modal()).findByText(/Mabu Owner.*Me/)).toBeInTheDocument();
    expect(
      within(modal()).getByRole('radiogroup', { name: 'Assign opening count to' })
    ).toBeInTheDocument();
    expect(within(modal()).getByText('Alex Operator')).toBeInTheDocument();

    // Selecting an operator is still pre-mutation; only Create opening count POSTs.
    fireEvent.click(within(modal()).getByRole('radio', { name: /Mabu Owner.*Me/i }));
    expect(within(modal()).getByRole('button', { name: 'Create opening count' })).toBeEnabled();
    expect(postCount()).toBe(0);
    expect(refresh).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('self-assignment POSTs assigned_to and opens the assigned task protected Brief route', async () => {
    getSpy.mockResolvedValueOnce({
      data: {
        operators: [
          { user_id: 7, first_name: 'Mabu', last_name: 'Owner', role: 'owner' },
          { user_id: 8, first_name: 'Alex', last_name: 'Operator', role: 'operator' },
        ],
      },
    });
    postSpy.mockResolvedValueOnce(startedProgress([bin('task-self')]));

    withOpeningItem(view('not_started'), true, 7);
    renderPanel();
    expandSetup();

    fireEvent.click(startButton());

    const assignment = await openingModal();

    fireEvent.click(
      await within(assignment).findByRole('radio', { name: /Mabu Owner.*Me/i })
    );
    fireEvent.click(
      within(assignment).getByRole('button', { name: 'Create opening count' })
    );

    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(
        START_URL,
        { assigned_to: 7 }
      )
    );

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/wms?countTaskId=task-self&warehouseFocus=count')
    );

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('assigning Opening Inventory to another operator dispatches work but never enters that operator task', async () => {
    getSpy.mockResolvedValueOnce({
      data: {
        operators: [
          { user_id: 7, first_name: 'Mabu', last_name: 'Owner', role: 'owner' },
          { user_id: 8, first_name: 'Alex', last_name: 'Operator', role: 'operator' },
        ],
      },
    });
    postSpy.mockResolvedValueOnce(startedProgress([bin('task-other')]));

    withOpeningItem(view('not_started'), true, 7);
    renderPanel();
    expandSetup();

    fireEvent.click(startButton());

    const assignment = await openingModal();

    fireEvent.click(
      await within(assignment).findByRole('radio', { name: /Alex Operator/i })
    );
    fireEvent.click(
      within(assignment).getByRole('button', { name: 'Create opening count' })
    );

    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(
        START_URL,
        { assigned_to: 8 }
      )
    );

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('multiple bins: self-assignment opens the first assigned dispatched bin in server order', async () => {
    getSpy.mockResolvedValueOnce({
      data: {
        operators: [
          { user_id: 7, first_name: 'Mabu', last_name: 'Owner', role: 'owner' },
          { user_id: 8, first_name: 'Alex', last_name: 'Operator', role: 'operator' },
        ],
      },
    });

    postSpy.mockResolvedValueOnce(
      startedProgress([
        bin('t-committed', {
          status: 'committed',
          progress_state: 'complete',
        }),
        bin('t-first-open', { location_code: 'Z-99' }),
        bin('t-second-open', { location_code: 'A-01' }),
      ])
    );

    withOpeningItem(view('not_started'), true, 7);
    renderPanel();
    expandSetup();

    fireEvent.click(startButton());

    const assignment = await openingModal();

    fireEvent.click(
      await within(assignment).findByRole('radio', { name: /Mabu Owner.*Me/i })
    );
    fireEvent.click(
      within(assignment).getByRole('button', { name: 'Create opening count' })
    );

    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(
        START_URL,
        { assigned_to: 7 }
      )
    );

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(
        '/wms?countTaskId=t-first-open&warehouseFocus=count'
      )
    );

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('self-assignment never enters an opening cohort owned by another operator', async () => {
    getSpy.mockResolvedValueOnce({
      data: {
        operators: [
          { user_id: 7, first_name: 'Mabu', last_name: 'Owner', role: 'owner' },
          { user_id: 8, first_name: 'Alex', last_name: 'Operator', role: 'operator' },
        ],
      },
    });

    postSpy.mockResolvedValueOnce(
      startedProgress([
        bin('t-other', { assigned_to: 8 }),
      ])
    );

    withOpeningItem(view('not_started'), true, 7);
    renderPanel();
    expandSetup();

    fireEvent.click(startButton());

    const assignment = await openingModal();

    fireEvent.click(
      await within(assignment).findByRole('radio', { name: /Mabu Owner.*Me/i })
    );
    fireEvent.click(
      within(assignment).getByRole('button', { name: 'Create opening count' })
    );

    expect(
      await within(assignment).findByRole('alert')
    ).toHaveTextContent(/\S/);

    expect(postCount()).toBe(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('rapid duplicate assignment issues exactly one POST and disables the assignment CTA while in flight', async () => {
    getSpy.mockResolvedValueOnce({
      data: {
        operators: [
          { user_id: 7, first_name: 'Mabu', last_name: 'Owner', role: 'owner' },
          { user_id: 8, first_name: 'Alex', last_name: 'Operator', role: 'operator' },
        ],
      },
    });

    let resolvePost: (value: unknown) => void = () => undefined;

    postSpy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        })
    );

    withOpeningItem(view('not_started'), true, 7);
    renderPanel();
    expandSetup();

    fireEvent.click(startButton());

    const assignment = modal();
    await within(assignment).findByRole('radio', { name: /Mabu Owner.*Me/i });

    fireEvent.click(
      within(assignment).getByRole('radio', { name: /Mabu Owner.*Me/i })
    );

    const assign = within(assignment).getByRole('button', {
      name: 'Create opening count',
    });

    act(() => {
      assign.click();
      assign.click();
    });

    expect(postCount()).toBe(1);
    const cancel = within(assignment).getByRole('button', { name: 'Cancel' });
    expect(cancel).toBeDisabled();
    fireEvent.click(cancel);
    fireEvent.click(within(assignment).getByRole('button', { name: 'Dismiss modal' }));
    expect(modal()).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();

    expect(
      within(assignment).getByRole('button', { name: 'Creating…' })
    ).toBeDisabled();

    await act(async () => {
      resolvePost(startedProgress([bin('t-1')]));
    });

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(
        '/wms?countTaskId=t-1&warehouseFocus=count'
      )
    );

    expect(postCount()).toBe(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('successful self-assignment refreshes canonical state before entering the Brief', async () => {
    getSpy.mockResolvedValueOnce({
      data: {
        operators: [
          { user_id: 7, first_name: 'Mabu', last_name: 'Owner', role: 'owner' },
          { user_id: 8, first_name: 'Alex', last_name: 'Operator', role: 'operator' },
        ],
      },
    });

    postSpy.mockResolvedValueOnce(
      startedProgress([bin('t-2')])
    );

    withOpeningItem(view('not_started'), true, 7);
    const { rerender } = renderPanel();
    expandSetup();

    fireEvent.click(startButton());

    const assignment = await openingModal();

    fireEvent.click(
      await within(assignment).findByRole('radio', { name: /Mabu Owner.*Me/i })
    );
    fireEvent.click(
      within(assignment).getByRole('button', { name: 'Create opening count' })
    );

    await waitFor(() =>
      expect(refresh).toHaveBeenCalledTimes(1)
    );

    expect(mockNavigate).toHaveBeenCalledWith(
      '/wms?countTaskId=t-2&warehouseFocus=count'
    );

    // Canonical re-read now reports counting.
    withOpeningItem(countingView(), true, 7);

    rerender(
      <OpsConsolePanel
        alerts={[alert()]}
        deepLink={deepLink}
        open
        onClose={jest.fn()}
      />
    );

    expect(
      within(openingRow()).queryByRole('button', {
        name: /start opening count/i,
      })
    ).toBeNull();

    expect(
      screen.getByTestId('ops-row-meta-setup:opening-inventory')
    ).toHaveTextContent('6 / 17 bins');

    expect(postCount()).toBe(1);
  });

  it('counting: shows canonical progress and Continue deep-links to the next count task, with no start command', () => {
    withOpeningItem(countingView());
    renderPanel();
    expandSetup();

    expect(screen.getByTestId('ops-row-meta-setup:opening-inventory')).toHaveTextContent('6 / 17 bins');
    expect(openingRow()).toHaveTextContent('Warehouse Operations · Inventory checks');
    expect(within(openingRow()).queryByRole('button', { name: /start/i })).toBeNull();

    fireEvent.click(within(openingRow()).getByRole('button', { name: /Continue/ }));
    expect(mockNavigate).toHaveBeenCalledWith('/wms?countTaskId=t-2&warehouseFocus=count');
    expect(mockNavigate).not.toHaveBeenCalledWith('/wms');
    expect(postSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('entity-detail-modal')).toBeNull();
  });

  it.each(['needs_bin_review', 'review_required'])(
    '%s: indicates review required and routes to the Warehouse opening inventory review surface',
    (state) => {
      withOpeningItem(view(state, { progress: { state, total_bins: 17, complete_bins: 17 } }));
      renderPanel();
      expandSetup();

      expect(openingRow()).toHaveAttribute('data-status', 'attention');
      expect(openingRow()).toHaveTextContent('Review required');

      fireEvent.click(within(openingRow()).getByRole('button', { name: /Review/ }));
      expect(mockNavigate).toHaveBeenCalledWith('/wms');
      expect(postSpy).not.toHaveBeenCalled();
    }
  );

  it('operator + not_started: the row is shown but no Start command can be issued', () => {
    withOpeningItem(view('not_started'), false);
    renderPanel();
    expandSetup();

    expect(openingRow()).toHaveTextContent('Establish opening inventory');
    expect(openingRow()).toHaveTextContent('Owner or admin must start');
    expect(openingRow()).toHaveAttribute('data-status', 'available');
    expect(within(openingRow()).queryByRole('button')).toBeNull();
    expect(postSpy).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('operator + counting: Continue is still offered and deep-links to the next count task', () => {
    withOpeningItem(countingView(), false);
    renderPanel();
    expandSetup();

    fireEvent.click(within(openingRow()).getByRole('button', { name: /Continue/ }));
    expect(mockNavigate).toHaveBeenCalledWith('/wms?countTaskId=t-2&warehouseFocus=count');
    expect(postSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['executing', 'waiting', /View/],
    ['failed', 'failed', /Retry/],
  ])('cutover %s: %s status, routed to the existing Warehouse cutover surface — the console never runs cutover', (status, rowStatus, cta) => {
    withOpeningItem(view('ready_for_cutover', { cutover: { status } }));
    renderPanel();
    expandSetup();

    expect(openingRow()).toHaveAttribute('data-status', rowStatus);
    fireEvent.click(within(openingRow()).getByRole('button', { name: cta }));
    expect(mockNavigate).toHaveBeenCalledWith('/wms');
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('assignment failure exposes stable merchant copy, preserves selection, and stays retryable', async () => {
    const rejected =
      'The opening count could not be started. Check that your warehouse has active bins, then try again.';

    getSpy.mockResolvedValueOnce({
      data: {
        operators: [
          { user_id: 7, first_name: 'Mabu', last_name: 'Owner', role: 'owner' },
          { user_id: 8, first_name: 'Alex', last_name: 'Operator', role: 'operator' },
        ],
      },
    });

    postSpy
      .mockRejectedValueOnce({
        response: {
          status: 409,
          data: {
            code: 'OPENING_START_REJECTED',
            error: rejected,
          },
        },
      })
      .mockRejectedValueOnce({
        response: {
          status: 403,
          data: {
            error: 'Forbidden: raw permission text',
          },
        },
      })
      .mockResolvedValueOnce(
        startedProgress([bin('t-retry')])
      );

    withOpeningItem(view('not_started'), true, 7);
    renderPanel();
    expandSetup();

    fireEvent.click(startButton());

    const assignment = await openingModal();

    const self = await within(assignment).findByRole('radio', {
      name: /Mabu Owner.*Me/i,
    });
    fireEvent.click(self);

    const assign = () =>
      within(assignment).getByRole('button', {
        name: /Create opening count|Creating…/,
      });

    fireEvent.click(assign());

    expect(
      await within(assignment).findByRole('alert')
    ).toHaveTextContent(rejected);

    expect(self).toHaveAttribute('aria-checked', 'true');
    expect(assign()).toBeEnabled();
    expect(refresh).not.toHaveBeenCalled();

    // Generic permission details must not leak, and the explicit assignee
    // remains selected so the merchant can retry.
    fireEvent.click(assign());

    await waitFor(() =>
      expect(
        within(assignment).getByRole('alert')
      ).toHaveTextContent(
        'The opening count could not be started. Try again.'
      )
    );

    expect(
      within(assignment).getByRole('alert')
    ).not.toHaveTextContent(/Forbidden/);

    expect(self).toHaveAttribute('aria-checked', 'true');
    expect(refresh).not.toHaveBeenCalled();

    fireEvent.click(assign());

    await waitFor(() =>
      expect(refresh).toHaveBeenCalledTimes(1)
    );

    expect(postCount()).toBe(3);

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(
        '/wms?countTaskId=t-retry&warehouseFocus=count'
      )
    );

  });

  it('leaves generic setup/navigation rows unchanged alongside the command row', () => {
    withOpeningItem(view('not_started'));
    renderPanel();
    expandSetup();

    const row = screen.getByTestId('ops-row-setup:map-zones');
    expect(row).toHaveAttribute('data-status', 'actionable');
    const open = within(row).getByRole('button');
    expect(open).toHaveTextContent('Open →');
    fireEvent.click(open);
    expect(mockNavigate).toHaveBeenCalledWith('/floor-planning?tab=setup&view=canvas');
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('only the Opening Inventory command POSTs to the start endpoint', () => {
    const source = codeOnly(fs.readFileSync(OPS_CONSOLE_SRC, 'utf8'));
    expect(source.match(/opening-inventory\/start/g)).toHaveLength(1);
    expect(source).toMatch(/if \(command !== 'opening_inventory_start'\) return;/);
  });

  it('preserves the GH-1158 open/close lifecycle with the command row present', async () => {
    withOpeningItem(view('not_started'));
    renderButton(<OpsConsoleButton alerts={[alert()]} deepLink={deepLink} />);
    const trigger = screen.getByRole('button', { name: /Ops Console/ });

    fireEvent.click(trigger);
    const panel = screen.getByTestId('ops-console');
    expect(panel).not.toHaveAttribute('inert');

    fireEvent.click(screen.getByRole('button', { name: 'Close Ops Console' }));
    expect(panel).toHaveAttribute('aria-hidden', 'true');
    expect(panel).toHaveAttribute('inert');
    await waitForElementToBeRemoved(panel);

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(postSpy).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

// ─── GH-1165 — FIRST-ENTRY OPS CONSOLE ONBOARDING ────────────────────────────

describe('first-entry Ops Console onboarding (GH-1165)', () => {
  const START_URL = '/api/v1/wms/opening-inventory/start';
  const RECOUNT_ASSIGNEES_URL = '/api/v1/operators/recount-assignees';
  const INTRO_URL = '/api/v1/user-state/ops-console/intro-seen';
  const { buildFirstEntrySetupItems, buildOpeningInventoryItem } = jest.requireActual('hooks/useActivationChecklist');
  const { OPS_CONSOLE_AUTO_OPEN_DELAY_MS, OPS_CONSOLE_INTRO_SEEN_KEY } = jest.requireActual('components/OpsConsole/OpsConsole');
  const view = (state: string) => ({
    progress: { state, total_bins: 0, complete_bins: 0 },
    cutover: null,
    shopify_synced_at: null,
  });

  let getSpy: jest.SpyInstance;
  let postSpy: jest.SpyInstance;
  const rq = jest.requireMock('@tanstack/react-query') as { useQuery: () => unknown };
  const originalUseQuery = rq.useQuery;

  /** First-entry hook output built by the real canonical projection. */
  function firstEntryChecklist(
    zonesConfigured: boolean,
    state = 'not_started',
    canStart = true,
    externalLocationMapped = false,
  ) {
    mockUseActivationChecklist.mockReturnValue({
      items: [...SETUP_ITEMS, buildOpeningInventoryItem(false, view(state), canStart)],
      completedCount: 1, allComplete: false, isLoading: false, isError: false,
      refreshOpeningInventory: jest.fn().mockResolvedValue(undefined),
      currentUserId: 7,
      firstEntry: true,
      firstEntryItems: buildFirstEntrySetupItems(
        zonesConfigured,
        externalLocationMapped,
        false,
        view(state),
        canStart,
      ),
    });
  }

  /** The onboarding-flags read as a loaded (or loading) server response. */
  function flagsRead(data: Record<string, boolean> | undefined, isSuccess = true) {
    rq.useQuery = () => ({ data, isSuccess });
  }

  const trigger = () => screen.getByRole('button', { name: /^Ops Console — / });
  const searchInput = () => screen.getByLabelText('Search orders, products, SKUs, barcodes, or batches');
  const introPosts = () => postSpy.mock.calls.filter(([url]) => url === INTRO_URL).length;
  const advance = (ms: number) => act(() => { jest.advanceTimersByTime(ms); });

  beforeEach(() => {
    getSpy = jest.spyOn(axiosInstance, 'get');
    postSpy = jest.spyOn(axiosInstance, 'post').mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    rq.useQuery = originalUseQuery;
    getSpy.mockRestore();
    postSpy.mockRestore();
    jest.useRealTimers();
  });

  // ── Composition ──

  it('fresh (#1160) first-entry: SETUP expanded first, exactly location + map + count, then NOW — no inline intro copy', () => {
    firstEntryChecklist(false);
    const { container } = renderPanel({ alerts: [alert({ id: 'a1' })] });

    // The explanatory intro is the one-time Spotlight now, never rail content.
    expect(screen.queryByText('Start here')).not.toBeInTheDocument();
    expect(screen.queryByText(/See what needs your attention/)).not.toBeInTheDocument();

    const toggle = screen.getByTestId('ops-first-entry-setup-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveTextContent('SETUP · 3 remaining');

    const setupRows = [...container.querySelectorAll('[data-section="SETUP"]')].map((el) => el.getAttribute('data-testid'));
    expect(setupRows).toEqual([
      'ops-row-setup:first-entry-shopify-location',
      'ops-row-setup:first-entry-map',
      'ops-row-setup:first-entry-count',
    ]);
    // The mature six-item SETUP is not rendered alongside it.
    expect(screen.queryByTestId('ops-setup-toggle')).not.toBeInTheDocument();

    // Setup-first: onboarding precedes NOW.
    const nowRow = screen.getByTestId('ops-row-alert:a1');
    expect(screen.getByTestId('ops-row-setup:first-entry-count').compareDocumentPosition(nowRow)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Search stays visible but passive.
    expect(searchInput()).toBeInTheDocument();
    expect(document.activeElement).not.toBe(searchInput());
  });

  it('Shopify location unmapped: Choose location is the only setup action; Map and Count stay gated', () => {
    firstEntryChecklist(false);
    renderPanel({ alerts: [] });

    const location = screen.getByTestId(
      'ops-row-setup:first-entry-shopify-location',
    );
    fireEvent.click(
      within(location).getByRole('button', { name: /Choose location/ }),
    );
    expect(mockNavigate).toHaveBeenCalledWith('/settings/warehouse');

    const map = screen.getByTestId('ops-row-setup:first-entry-map');
    expect(map).toHaveTextContent('Map warehouse basics');
    expect(within(map).queryByRole('button')).toBeNull();

    const count = screen.getByTestId('ops-row-setup:first-entry-count');
    expect(count).toHaveTextContent('Count opening stock');
    expect(count).toHaveTextContent(
      'Choose your Shopify location first so LaSyncro knows where inventory updates belong.',
    );
    expect(within(count).queryByRole('button')).toBeNull();

    expect(
      postSpy.mock.calls.filter(([url]) => url === START_URL),
    ).toHaveLength(0);
  });

  it('zonesConfigured=true + not_started + owner: minimum basics satisfied and mapping remains reachable; Start opening count advances to explicit assignment without creating work', async () => {
    getSpy.mockResolvedValueOnce({
      data: {
        operators: [
          { user_id: 7, first_name: 'Mabu', last_name: 'Owner', role: 'owner' },
          { user_id: 8, first_name: 'Alex', last_name: 'Operator', role: 'operator' },
        ],
      },
    });

    firstEntryChecklist(true, 'not_started', true, true);
    renderPanel({ alerts: [] });

    expect(
      screen.getByTestId('ops-row-setup:first-entry-shopify-location')
    ).toHaveAttribute('data-status', 'verified');

    expect(
      screen.getByTestId('ops-row-setup:first-entry-map')
    ).toHaveAttribute('data-status', 'verified');
    // GH-1183 contract correction: verified minimum basics is not a finished floor.
    const mapBasics = screen.getByTestId('ops-row-setup:first-entry-map');
    expect(mapBasics).toHaveTextContent(/map.*basics/i);
    expect(within(mapBasics).getByRole('button', { name: /map/i })).toBeEnabled();


    expect(
      screen.getByTestId('ops-first-entry-setup-toggle')
    ).toHaveTextContent('SETUP · 1 remaining');

    const count = screen.getByTestId('ops-row-setup:first-entry-count');

    fireEvent.click(
      within(count).getByRole('button', { name: 'Start opening count' })
    );

    const explanation = screen.getByTestId('entity-detail-modal');

    expect(explanation).toHaveAttribute(
      'aria-label',
      'Start opening inventory count'
    );

    expect(
      postSpy.mock.calls.filter(([url]) => url === START_URL)
    ).toHaveLength(0);

    await waitFor(() =>
      expect(getSpy).toHaveBeenCalledWith(RECOUNT_ASSIGNEES_URL)
    );

    const assignment = explanation;

    expect(
      await within(assignment).findByText(/Mabu Owner.*Me/)
    ).toBeInTheDocument();

    expect(
      within(assignment).getByRole('radiogroup', {
        name: 'Assign opening count to',
      })
    ).toBeInTheDocument();

    expect(
      within(assignment).getByText('Alex Operator')
    ).toBeInTheDocument();

    // Assignment selection is still pre-mutation.
    expect(
      postSpy.mock.calls.filter(([url]) => url === START_URL)
    ).toHaveLength(0);

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('zonesConfigured=true + not_started + operator: no Start command', () => {
    firstEntryChecklist(true, 'not_started', false, true);
    renderPanel({ alerts: [] });

    const count = screen.getByTestId('ops-row-setup:first-entry-count');
    expect(count).toHaveTextContent('Owner or admin must start');
    expect(within(count).queryByRole('button')).toBeNull();
  });

  it('after canonical reconciliation: mature NOW-first / six-item composition resumes', () => {
    mockUseActivationChecklist.mockReturnValue({
      items: SETUP_ITEMS, completedCount: 1, allComplete: false,
      isLoading: false, isError: false, firstEntry: false, firstEntryItems: [],
    });
    renderPanel({ alerts: [alert({ id: 'a1' })] });

    expect(screen.queryByText('Start here')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ops-first-entry-setup-toggle')).not.toBeInTheDocument();
    const setup = screen.getByTestId('ops-setup-toggle');
    expect(setup).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('ops-row-alert:a1').compareDocumentPosition(setup)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // ── Once-only auto-open ──

  it('pulses, then auto-opens once after the delay without focusing search, and persists intro-seen', () => {
    jest.useFakeTimers();
    firstEntryChecklist(false);
    flagsRead({});
    renderButton(<OpsConsoleButton alerts={[]} deepLink={deepLink} />);

    expect(OPS_CONSOLE_AUTO_OPEN_DELAY_MS).toBeGreaterThanOrEqual(500);
    expect(OPS_CONSOLE_AUTO_OPEN_DELAY_MS).toBeLessThanOrEqual(800);
    expect(trigger()).toHaveAttribute('data-pulse', 'true');
    expect(screen.queryByTestId('ops-console')).not.toBeInTheDocument();

    advance(OPS_CONSOLE_AUTO_OPEN_DELAY_MS - 1);
    expect(screen.queryByTestId('ops-console')).not.toBeInTheDocument();
    advance(1);

    expect(screen.getByTestId('ops-console')).toBeInTheDocument();
    expect(document.activeElement).not.toBe(searchInput());
    expect(introPosts()).toBe(1);
    expect(postSpy.mock.calls.find(([url]) => url === INTRO_URL)).toEqual([INTRO_URL]);
    // Never a setup completion write.
    expect(postSpy.mock.calls.filter(([url]) => url !== INTRO_URL)).toHaveLength(0);

    // The merchant can close it immediately; it does not come back.
    fireEvent.click(screen.getByRole('button', { name: 'Close Ops Console' }));
    advance(10 * OPS_CONSOLE_AUTO_OPEN_DELAY_MS);
    expect(screen.queryByTestId('ops-console')).not.toBeInTheDocument();
    expect(introPosts()).toBe(1);
  });

  it('writes the persisted flag into the shared onboarding-flags cache on success', async () => {
    jest.useFakeTimers();
    firstEntryChecklist(false);
    flagsRead({});
    renderButton(<OpsConsoleButton alerts={[]} deepLink={deepLink} />);
    advance(OPS_CONSOLE_AUTO_OPEN_DELAY_MS);

    await act(async () => { await Promise.resolve(); });
    expect(mockSetQueryData).toHaveBeenCalledWith(['user-state', 'onboarding-flags'], expect.any(Function));
    const update = mockSetQueryData.mock.calls[0][1] as (old?: Record<string, boolean>) => Record<string, boolean>;
    expect(update({ 'checklist:completed': false })).toEqual({
      'checklist:completed': false, [OPS_CONSOLE_INTRO_SEEN_KEY]: true,
    });
  });

  it('persisted intro-seen flag prevents any automatic reopen on remount/reload', () => {
    jest.useFakeTimers();
    firstEntryChecklist(false);
    flagsRead({ [OPS_CONSOLE_INTRO_SEEN_KEY]: true });

    const first = renderButton(<OpsConsoleButton alerts={[]} deepLink={deepLink} />);
    advance(10 * OPS_CONSOLE_AUTO_OPEN_DELAY_MS);
    expect(screen.queryByTestId('ops-console')).not.toBeInTheDocument();
    first.unmount();

    renderButton(<OpsConsoleButton alerts={[]} deepLink={deepLink} />);
    advance(10 * OPS_CONSOLE_AUTO_OPEN_DELAY_MS);
    expect(screen.queryByTestId('ops-console')).not.toBeInTheDocument();
    expect(trigger()).not.toHaveAttribute('data-pulse');
    expect(introPosts()).toBe(0);
  });

  it.each([
    ['flags still loading', () => { firstEntryChecklist(false); flagsRead(undefined, false); }],
    ['flags read failed/missing', () => { firstEntryChecklist(false); rq.useQuery = () => ({ data: undefined }); }],
    ['not first-entry', () => { flagsRead({}); }],
  ])('fails closed when %s: no pulse, no auto-open, no write', (_label, arrange) => {
    jest.useFakeTimers();
    arrange();
    renderButton(<OpsConsoleButton alerts={[]} deepLink={deepLink} />);
    advance(10 * OPS_CONSOLE_AUTO_OPEN_DELAY_MS);

    expect(screen.queryByTestId('ops-console')).not.toBeInTheDocument();
    expect(trigger()).not.toHaveAttribute('data-pulse');
    expect(introPosts()).toBe(0);
  });

  it('a manual open during the pending intro consumes it: no later auto-reopen', () => {
    jest.useFakeTimers();
    firstEntryChecklist(false);
    flagsRead({});
    renderButton(<OpsConsoleButton alerts={[]} deepLink={deepLink} />);

    fireEvent.click(trigger());
    fireEvent.click(trigger());
    advance(10 * OPS_CONSOLE_AUTO_OPEN_DELAY_MS);

    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(introPosts()).toBe(1);
  });

  // ── Search intent ──

  it('manual trigger opens attention mode and never autofocuses search', () => {
    renderButton(<OpsConsoleButton alerts={[alert()]} deepLink={deepLink} />);
    fireEvent.click(trigger());

    expect(screen.getByTestId('ops-console')).toBeInTheDocument();
    expect(document.activeElement).not.toBe(searchInput());
  });

  it('Ctrl+K (non-macOS) while closed opens the console with search focused and suppresses the browser default', () => {
    renderButton(<OpsConsoleButton alerts={[alert()]} deepLink={deepLink} />);

    const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => { window.dispatchEvent(event); });

    expect(event.defaultPrevented).toBe(true);
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(document.activeElement).toBe(searchInput());
  });

  it('Ctrl+K while already open focuses search; a later manual reopen does not', async () => {
    renderButton(<OpsConsoleButton alerts={[alert()]} deepLink={deepLink} />);
    fireEvent.click(trigger());
    expect(document.activeElement).not.toBe(searchInput());

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true })); });
    expect(document.activeElement).toBe(searchInput());

    fireEvent.click(screen.getByRole('button', { name: 'Close Ops Console' }));
    await waitForElementToBeRemoved(() => screen.queryByTestId('ops-console'));
    fireEvent.click(trigger());
    expect(screen.getByTestId('ops-console')).toBeInTheDocument();
    expect(document.activeElement).not.toBe(searchInput());
  });

  it('Cmd+K on macOS opens into search; Ctrl+K on macOS is left alone', () => {
    const platform = jest.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');
    try {
      renderButton(<OpsConsoleButton alerts={[alert()]} deepLink={deepLink} />);

      const ctrl = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true });
      act(() => { window.dispatchEvent(ctrl); });
      expect(ctrl.defaultPrevented).toBe(false);
      expect(trigger()).toHaveAttribute('aria-expanded', 'false');

      const cmd = new KeyboardEvent('keydown', { key: 'k', metaKey: true, cancelable: true });
      act(() => { window.dispatchEvent(cmd); });
      expect(cmd.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(searchInput());
    } finally {
      platform.mockRestore();
    }
  });

  // ── First-contact Spotlight ──

  // sm+ presentation (beside the rail) and xs presentation (inside the rail)
  // of the ONE Spotlight. jsdom evaluates no media queries, so both mount
  // while active; the breakpoint split is asserted as a source contract below.
  const spotlight = () => screen.queryByTestId('ops-first-contact-spotlight');
  const inlineSpotlight = () => screen.queryByTestId('ops-first-contact-spotlight-inline');
  const anySpotlight = () => document.querySelector('[data-testid^="ops-first-contact-spotlight"]');
  const dimmer = () => screen.queryByTestId('ops-first-contact-dimmer');
  const {
    OPS_FIRST_CONTACT_SPOTLIGHT, OPS_SPOTLIGHT_DESKTOP_DISPLAY, OPS_SPOTLIGHT_MOBILE_DISPLAY,
  } = jest.requireActual('components/OpsConsole/OpsConsole');

  it('desktop automatic first entry: Spotlight beside SETUP over a dimmed canvas; the dimmer never dismisses; search stays passive', () => {
    jest.useFakeTimers();
    firstEntryChecklist(false);
    flagsRead({});
    renderButton(<OpsConsoleButton alerts={[]} deepLink={deepLink} />);
    expect(anySpotlight()).toBeNull();
    advance(OPS_CONSOLE_AUTO_OPEN_DELAY_MS);

    const rail = screen.getByTestId('ops-console');
    const coach = spotlight()!;
    expect(coach).toHaveTextContent('Start here');
    expect(coach).toHaveTextContent(
      'Ops Console shows what needs your attention and what to do next. First, tell LaSyncro which Shopify Location this warehouse represents.');
    expect(OPS_FIRST_CONTACT_SPOTLIGHT.title).toBe('Start here');
    expect(dimmer()).toBeInTheDocument();
    // Outside the rail: SETUP stays inline in the rail, never inside the coach.
    expect(rail.contains(coach)).toBe(false);
    expect(rail.contains(dimmer())).toBe(false);
    expect(within(rail).getByTestId('ops-first-entry-setup-toggle')).toHaveAttribute('aria-expanded', 'true');
    expect(within(rail).getByTestId('ops-row-setup:first-entry-map')).toBeInTheDocument();
    // Not a modal: no MUI Modal/Backdrop, no focus capture.
    expect(document.querySelector('.MuiModal-root, .MuiBackdrop-root, [aria-modal="true"]')).toBeNull();
    expect(document.activeElement).not.toBe(searchInput());
    expect(coach.contains(document.activeElement)).toBe(false);

    // The dimmer is a visual layer only: clicking it dismisses nothing.
    fireEvent.click(dimmer()!);
    expect(spotlight()).toBeInTheDocument();
    expect(dimmer()).toBeInTheDocument();
    expect(introPosts()).toBe(1);

    expect(within(coach).queryByRole('button', { name: 'Got it' })).toBeNull();
    fireEvent.click(within(coach).getByRole('button', { name: 'Choose Shopify location' }));
    expect(anySpotlight()).toBeNull();
    expect(dimmer()).toBeNull();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(mockNavigate).toHaveBeenCalledWith('/settings/warehouse?guide=shopify-location');
  });

  it('xs first auto-open: the same coach renders inside the rail above location/map/count SETUP; dismissal removes the coach only', () => {
    jest.useFakeTimers();
    firstEntryChecklist(false);
    flagsRead({});
    renderButton(<OpsConsoleButton alerts={[]} deepLink={deepLink} />);
    advance(OPS_CONSOLE_AUTO_OPEN_DELAY_MS);

    const rail = screen.getByTestId('ops-console');
    const inline = inlineSpotlight()!;
    expect(inline).toHaveTextContent('Start here');
    expect(inline).toHaveTextContent(
      'Ops Console shows what needs your attention and what to do next. First, tell LaSyncro which Shopify Location this warehouse represents.');
    // Inside the rail's first-entry area, immediately above SETUP, never over its rows.
    const setupBlock = within(rail).getByTestId('ops-first-entry-setup');
    expect(setupBlock.contains(inline)).toBe(true);
    const toggle = within(rail).getByTestId('ops-first-entry-setup-toggle');
    expect(inline.nextElementSibling).toBe(toggle);
    for (const id of [
      'ops-row-setup:first-entry-shopify-location',
      'ops-row-setup:first-entry-map',
      'ops-row-setup:first-entry-count',
    ]) {
      const row = within(rail).getByTestId(id);
      expect(inline.contains(row)).toBe(false);
    }
    // Dismissal removes the coach only. It runs while the rail is still open:
    // any close clears the coach and a later open never raises it again.
    fireEvent.click(within(inline).getByRole('button', { name: 'Dismiss' }));
    expect(anySpotlight()).toBeNull();
    expect(dimmer()).toBeNull();
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(rail).getByTestId('ops-row-setup:first-entry-count')).toBeInTheDocument();

    fireEvent.click(
      within(
        within(rail).getByTestId(
          'ops-row-setup:first-entry-shopify-location',
        ),
      ).getByRole('button', { name: /Choose location/ }),
    );
    expect(mockNavigate).toHaveBeenCalledWith('/settings/warehouse');
    // GH-1164 — cross-page navigation hands the workspace to the destination
    // and closes the rail. The real Ops Console trigger reports it; the SETUP
    // disclosure (ops-first-entry-setup-toggle) is not the rail trigger.
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(postSpy.mock.calls.filter(([url]) => url !== INTRO_URL)).toHaveLength(0);

    // Later reopen: no Spotlight in either presentation.
    advance(10 * OPS_CONSOLE_AUTO_OPEN_DELAY_MS);
    fireEvent.click(trigger());
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('ops-console')).toBeInTheDocument();
    expect(anySpotlight()).toBeNull();
    expect(introPosts()).toBe(1);
  });

  it('coach body wraps in both presentations: explicit wrapping, never an inherited top-nav nowrap', () => {
    jest.useFakeTimers();
    firstEntryChecklist(false);
    flagsRead({});
    renderButton(<OpsConsoleButton alerts={[]} deepLink={deepLink} />);
    advance(OPS_CONSOLE_AUTO_OPEN_DELAY_MS);

    for (const coach of [spotlight()!, inlineSpotlight()!]) {
      const body = within(coach).getByText(OPS_FIRST_CONTACT_SPOTLIGHT.body);
      expect(body).toHaveStyle({ whiteSpace: 'normal', wordBreak: 'normal', maxWidth: '100%' });
      expect(getComputedStyle(body).getPropertyValue('overflow-wrap')).toBe('break-word');
    }
    const coachSource = codeOnly(fs.readFileSync(
      path.join(REPO_ROOT, 'modules/shared/src/ui/SpotlightCoachMark.tsx'), 'utf8'));
    expect(coachSource).not.toMatch(/nowrap/);
  });

  it('breakpoint contract: desktop coach + dimmer are sm+ only, the inline coach is xs only, and the dimmer has no dismissal handler', () => {
    expect(OPS_SPOTLIGHT_DESKTOP_DISPLAY).toEqual({ xs: 'none', sm: 'block' });
    expect(OPS_SPOTLIGHT_MOBILE_DISPLAY).toEqual({ xs: 'block', sm: 'none' });

    const source = codeOnly(fs.readFileSync(OPS_CONSOLE_SRC, 'utf8'));
    // Locates a test id as a quoted token, whether it is a plain attribute or
    // one branch of a conditional (GH-1183 map→count reuses this presentation).
    const block = (testId: string) => {
      const escaped = testId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = source.match(
        new RegExp(`['"]${escaped}['"]`),
      );
      const at = match?.index ?? -1;

      expect(at).toBeGreaterThan(-1);

      // The whole opening tag: from its `<Box` to the end of its sx.
      return source.slice(
        source.lastIndexOf('<Box', at),
        source.indexOf('>', source.indexOf('}}', at)),
      );
    };
    const dimmerBlock = block('ops-first-contact-dimmer');
    expect(dimmerBlock).toMatch(/display: OPS_SPOTLIGHT_DESKTOP_DISPLAY/);
    expect(dimmerBlock).not.toMatch(/onClick|onMouseDown|onPointerDown/);
    const spotlightBlock = block('ops-first-contact-spotlight');
    expect(spotlightBlock).toMatch(/display: OPS_SPOTLIGHT_DESKTOP_DISPLAY/);
    expect(block('ops-first-contact-spotlight-inline')).toMatch(/display: OPS_SPOTLIGHT_MOBILE_DISPLAY/);
    // Map→count reuses the same desktop presentation and dismissal layer.
    expect(block('ops-map-count-dimmer')).toBe(dimmerBlock);
    expect(block('ops-map-count-spotlight')).toBe(spotlightBlock);
  });

  it('dismissal (X) removes coach + dimmer only; Ops stays open with SETUP expanded and nothing completed', () => {
    for (const control of ['Dismiss']) {
      jest.useFakeTimers();
      firstEntryChecklist(false);
      flagsRead({});
      const view = renderButton(<OpsConsoleButton alerts={[]} deepLink={deepLink} />);
      advance(OPS_CONSOLE_AUTO_OPEN_DELAY_MS);

      // Real, keyboard-reachable buttons.
      fireEvent.click(within(spotlight()!).getByRole('button', { name: control }));

      expect(anySpotlight()).toBeNull();
      expect(dimmer()).toBeNull();
      expect(trigger()).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByTestId('ops-first-entry-setup-toggle')).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByTestId('ops-row-setup:first-entry-map')).not.toHaveAttribute('data-status', 'verified');
      expect(postSpy.mock.calls.filter(([url]) => url !== INTRO_URL)).toHaveLength(0);
      view.unmount();
      jest.useRealTimers();
    }
  });

  it('reload with the intro-seen flag: no auto-open and no Spotlight, even on a manual open', () => {
    jest.useFakeTimers();
    firstEntryChecklist(false);
    flagsRead({ [OPS_CONSOLE_INTRO_SEEN_KEY]: true });
    renderButton(<OpsConsoleButton alerts={[]} deepLink={deepLink} />);
    advance(10 * OPS_CONSOLE_AUTO_OPEN_DELAY_MS);
    expect(screen.queryByTestId('ops-console')).not.toBeInTheDocument();

    fireEvent.click(trigger());
    expect(screen.getByTestId('ops-console')).toBeInTheDocument();
    expect(anySpotlight()).toBeNull();
    expect(dimmer()).toBeNull();
    expect(screen.queryByText('Start here')).not.toBeInTheDocument();
    expect(introPosts()).toBe(0);
  });

  it('manual first click before the timer: Spotlight once, search passive, delayed auto-open suppressed; later opens are plain', () => {
    jest.useFakeTimers();
    firstEntryChecklist(false);
    flagsRead({});
    renderButton(<OpsConsoleButton alerts={[]} deepLink={deepLink} />);

    fireEvent.click(trigger());
    expect(screen.getAllByTestId('ops-first-contact-spotlight')).toHaveLength(1);
    expect(dimmer()).toBeInTheDocument();
    expect(document.activeElement).not.toBe(searchInput());

    advance(10 * OPS_CONSOLE_AUTO_OPEN_DELAY_MS);
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByTestId('ops-first-contact-spotlight')).toHaveLength(1);
    expect(introPosts()).toBe(1);

    // Closing without dismissing never carries the Spotlight into a later open.
    fireEvent.click(trigger());
    expect(anySpotlight()).toBeNull();
    advance(10 * OPS_CONSOLE_AUTO_OPEN_DELAY_MS);
    fireEvent.click(trigger());
    expect(screen.getByTestId('ops-console')).toBeInTheDocument();
    expect(anySpotlight()).toBeNull();
    expect(dimmer()).toBeNull();
    expect(introPosts()).toBe(1);
  });

  it('Ctrl+K first contact: search intent wins — search focused, no Spotlight or dimmer, now or after the timer', () => {
    jest.useFakeTimers();
    firstEntryChecklist(false);
    flagsRead({});
    renderButton(<OpsConsoleButton alerts={[]} deepLink={deepLink} />);

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true })); });
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(document.activeElement).toBe(searchInput());
    expect(anySpotlight()).toBeNull();
    expect(dimmer()).toBeNull();
    expect(introPosts()).toBe(1);

    advance(10 * OPS_CONSOLE_AUTO_OPEN_DELAY_MS);
    expect(anySpotlight()).toBeNull();
    expect(dimmer()).toBeNull();
  });

  it('Ctrl+K while the Spotlight is showing withdraws it in favour of search', () => {
    jest.useFakeTimers();
    firstEntryChecklist(false);
    flagsRead({});
    renderButton(<OpsConsoleButton alerts={[]} deepLink={deepLink} />);
    advance(OPS_CONSOLE_AUTO_OPEN_DELAY_MS);
    expect(spotlight()).toBeInTheDocument();

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true })); });
    expect(document.activeElement).toBe(searchInput());
    expect(anySpotlight()).toBeNull();
    expect(dimmer()).toBeNull();
  });

  it('mature Ops: opens carry no onboarding copy, Spotlight or dimmer', () => {
    jest.useFakeTimers();
    flagsRead({});
    renderButton(<OpsConsoleButton alerts={[alert()]} deepLink={deepLink} />);
    advance(10 * OPS_CONSOLE_AUTO_OPEN_DELAY_MS);

    fireEvent.click(trigger());
    expect(screen.getByTestId('ops-console')).toBeInTheDocument();
    expect(anySpotlight()).toBeNull();
    expect(dimmer()).toBeNull();
    expect(screen.queryByText('Start here')).not.toBeInTheDocument();
    expect(introPosts()).toBe(0);
  });

  it('adds no second persistence mechanism for the Spotlight', () => {
    const source = codeOnly(fs.readFileSync(OPS_CONSOLE_SRC, 'utf8'));
    expect(source).not.toMatch(/useSpotlight|spotlight:|localStorage|sessionStorage/);
    // Both once-only guidance claims (first contact and
    // GH-1183 map→count) are server-side user_states flags written through
    // the canonical user-state endpoint.
    const urlOf = (name: string) => source.match(new RegExp(`const ${name} = '([^']+)'`))?.[1];
    expect(urlOf('OPS_CONSOLE_INTRO_SEEN_URL')).toBe('/api/v1/user-state/ops-console/intro-seen');
    expect(source).not.toMatch(/SHOPIFY_LOCATION_SEEN|shopifyLocationActive|shopifyLocationRequest/);
    expect(urlOf('MAP_COUNT_SEEN_URL')).toBe('/api/v1/user-state/ops-console/map-count-handoff-seen');
    expect(source).toMatch(/axiosInstance\.post\(OPS_CONSOLE_INTRO_SEEN_URL\)/);
    expect(source).toMatch(/axiosInstance\.post\(MAP_COUNT_SEEN_URL\)/);
    // No other user-state write exists: unrelated business writes are allowed,
    // a second onboarding-state channel is not.
    const userStateWrites = [...source.matchAll(/axiosInstance\.(?:post|put|patch|delete)\(\s*([A-Z_]+|'[^']*')/g)]
      .map(([, target]) => (target.startsWith("'") ? target.slice(1, -1) : urlOf(target)))
      .filter((url) => url === undefined || url.startsWith('/api/v1/user-state/'));
    expect(userStateWrites.sort()).toEqual([
      '/api/v1/user-state/ops-console/intro-seen',
      '/api/v1/user-state/ops-console/map-count-handoff-seen',
    ]);
  });

  // ── Persistence and ownership boundaries ──

  it('uses no browser storage for intro, setup or search state', () => {
    for (const file of [OPS_CONSOLE_SRC, CHECKLIST_HOOK_SRC]) {
      expect(codeOnly(fs.readFileSync(file, 'utf8'))).not.toMatch(/localStorage|sessionStorage/);
    }
  });

  it('keeps shortcut and auto-open ownership inside the console, not the topnav', () => {
    const topnav = codeOnly(fs.readFileSync(TOPNAV_SRC, 'utf8'));
    expect(topnav).not.toMatch(/keydown|metaKey|ctrlKey|intro-seen/);
    const overview = codeOnly(fs.readFileSync(
      path.join(REPO_ROOT, 'modules/overview/src/ui/pages/OverviewModuleFT2.tsx'), 'utf8'));
    expect(overview).not.toMatch(/OpsConsole|intro-seen/);
  });
});
