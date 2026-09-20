// tests/unit/ui/ops-console/ops-console-waiting-v1-contract.test.tsx
//
// OPS-CONSOLE-WAITING-01 (RED CONTRACT) — surface-level proof that the
// rendered rail consumes a backend-supplied WAITING feed rather than
// manufacturing rows locally. Companion to:
//   - ops-console-model.test.ts's pure-function WAITING contract (items 17, 22)
//   - the backend contract in
//     tests/integration/decisions/ops-console-waiting-v1-contract.test.ts
//     (items 1-16)
//
// Does NOT touch the existing "WAITING is absent when nothing is supplied"
// tests in ops-console-surface.test.tsx (lines ~337-340, ~935-938,
// ~1401-1408) — those remain valid under V1 (see the accompanying report's
// section C): a zero-item backend feed must still render nothing, which is
// exactly what those tests already assert against the CURRENT zero-argument
// buildWaitingRows(). This file adds the populated-feed counterpart.

import path from 'path';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import type { Alert } from 'pages/alerts/useAlerts';

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

jest.mock('pages/wms/usePickBatches', () => ({
  usePickBatches: () => ({ data: { batches: [] }, isLoading: false, isError: false }),
  usePickBatchOrders: () => ({ data: { orders: [] }, isLoading: false, isError: false }),
}));

jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: {} }),
  useMutation: () => ({ mutateAsync: jest.fn() }),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
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

import { OpsConsolePanel } from 'components/OpsConsole';

void path; // referenced only to keep parity with sibling test files' REPO_ROOT-style imports

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
];

/**
 * Backend WAITING feed item shape — mirrors the one asserted against the
 * real endpoint in the backend contract. Copy is NOT ratified: title /
 * subtitle / actionLabel below are deliberately distinctive nonsense,
 * unrelated to `treatment`'s wording, so a passing render proves the panel
 * shows backend copy verbatim rather than deriving plausible-looking
 * address/inventory copy of its own. Only routing.route is real/ratified.
 */
function waitingItem(over: Record<string, unknown> = {}) {
  return {
    interventionId: 'intv-1',
    treatment: 'address_correction',
    lasyncroOrderId: 'order-1',
    externalOrderId: '#1001',
    constraintId: 'constraint-1',
    constraintType: 'customer',
    blockType: 'incomplete_address',
    occurredAt: '2026-09-18T10:00:00.000Z',
    outcome: 'pending_verification',
    presentation: {
      title: 'ZZQ-7 marker',
      subtitle: 'backend-supplied waiting copy #482',
      actionLabel: 'Do the thing',
    },
    routing: { route: '/overview?resolution=address' },
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseActivationChecklist.mockReturnValue({
    items: SETUP_ITEMS, completedCount: 1, allComplete: true,
    isLoading: false, isError: false,
  });
  mockUseAlerts.mockReturnValue({
    data: { data: [], meta: { total: 0, status: 'resolved' } },
    isLoading: false, isError: false,
  });
});

function renderPanel(props: Partial<React.ComponentProps<typeof OpsConsolePanel>> = {}) {
  return render(
    <OpsConsolePanel alerts={[]} deepLink={deepLink} open onClose={jest.fn()} {...(props as any)} />
  );
}

// ─── item 18 / 19 / 20 ────────────────────────────────────────────────────

describe('WAITING V1 — renders only backend-supplied pending items (items 18, 19, 20)', () => {
  it('renders a WAITING section and a status="waiting" row when the backend feed carries a pending_verification item, showing the backend copy verbatim (not derived from treatment)', () => {
    renderPanel({ waitingItems: [waitingItem()] } as any);

    expect(screen.getByText('WAITING')).toBeInTheDocument();
    const row = screen.getByTestId('ops-row-waiting:intv-1');
    expect(row).toBeInTheDocument();
    expect(row).toHaveAttribute('data-status', 'waiting');
    expect(row).toHaveAttribute('data-section', 'WAITING');
    // Deliberately distinctive fixture copy (see waitingItem() header note),
    // rendered exactly — proves pass-through, not local generation.
    expect(screen.getByText('ZZQ-7 marker')).toBeInTheDocument();
    expect(screen.getByText('backend-supplied waiting copy #482')).toBeInTheDocument();
  });

  it('renders no WAITING section when the backend feed is an empty array (unchanged from the prior absent-in-V1 contract)', () => {
    renderPanel({ waitingItems: [] } as any);
    expect(screen.queryByText('WAITING')).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-status="waiting"]')).toHaveLength(0);
  });

  it('renders no WAITING section when no waitingItems prop is supplied at all — prop absence must behave like an empty feed, not an error', () => {
    renderPanel();
    expect(screen.queryByText('WAITING')).not.toBeInTheDocument();
  });
});

// ─── item 21 ───────────────────────────────────────────────────────────────

describe('WAITING V1 — does not alter SETUP or HISTORY composition (item 21)', () => {
  it('SETUP still renders from useActivationChecklist alone with WAITING items present', () => {
    renderPanel({ waitingItems: [waitingItem()] } as any);
    expect(screen.getByTestId('ops-setup-complete')).toBeInTheDocument();
  });

  it('HISTORY tab composition is unaffected by WAITING items', () => {
    mockUseAlerts.mockReturnValue({
      data: {
        data: [alert({ id: 'r1', resolved_at: '2026-09-08T09:00:00.000Z' })],
        meta: { total: 1, status: 'resolved' },
      },
      isLoading: false, isError: false,
    });
    renderPanel({ waitingItems: [waitingItem()] } as any);
    fireEvent.click(screen.getByRole('tab', { name: 'HISTORY' }));
    expect(screen.getByTestId('ops-row-history:r1')).toBeInTheDocument();
  });
});

// ─── item 22 ───────────────────────────────────────────────────────────────

describe('WAITING V1 — no synthetic rows from out-of-scope sources (item 22)', () => {
  it('a stock_protection NOW alert never leaks into the WAITING section merely because WAITING items are present', () => {
    const stockProtectionAlert = alert({
      id: 'sp1',
      alert_type: 'stock_protection',
      entity_type: 'variant',
      entity_id: 'v1',
      action: { route: '/inventory/catalog', label: 'Review' } as any,
    });
    renderPanel({ alerts: [stockProtectionAlert], waitingItems: [waitingItem()] } as any);

    expect(document.querySelectorAll('[data-status="waiting"]')).toHaveLength(1);
    // The stock_protection alert renders as a NOW row (its own section), never as WAITING.
    const spRow = screen.queryByTestId('ops-row-alert:sp1');
    if (spRow) {
      expect(spRow).toHaveAttribute('data-section', 'NOW');
      expect(spRow).not.toHaveAttribute('data-status', 'waiting');
    }
  });
});

// ─── item 23 ───────────────────────────────────────────────────────────────

describe('WAITING V1 — existing NOW/Decision Feed ordering is unchanged (item 23)', () => {
  it('NOW row order with alerts present is unaffected by the presence of waitingItems', () => {
    const { container } = renderPanel({
      alerts: [alert({ id: 'a1' }), alert({ id: 'a2', alert_type: 'sla_breach' })],
      waitingItems: [waitingItem()],
    } as any);

    const nowIds = Array.from(container.querySelectorAll('[data-section="NOW"]')).map((el) =>
      el.getAttribute('data-testid')
    );
    expect(nowIds).toEqual(['ops-row-alert:a1', 'ops-row-alert:a2']);
  });
});
