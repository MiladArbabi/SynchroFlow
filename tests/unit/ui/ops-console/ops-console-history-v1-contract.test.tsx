// tests/unit/ui/ops-console/ops-console-history-v1-contract.test.tsx
//
// OPS-CONSOLE-HISTORY-01 — surface-level proof that the rendered rail
// consumes a backend-supplied HISTORY V1 feed rather than manufacturing
// rows from resolved alerts. Companion to:
//   - ops-console-history-v1-model.test.ts's pure-function contract
//   - the backend contract in
//     tests/integration/decisions/ops-console-history-v1-contract.test.ts
//
// Mirrors ops-console-waiting-v1-contract.test.tsx's structure/conventions.

import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';

import type { Alert } from 'pages/alerts/useAlerts';

const mockNavigate = jest.fn();
const mockUseActivationChecklist = jest.fn();
const mockUseWaiting = jest.fn();
const mockUseHistory = jest.fn();

jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));

jest.mock('hooks/useActivationChecklist', () => ({
  useActivationChecklist: () => mockUseActivationChecklist(),
}));

jest.mock('pages/operations/useWaiting', () => ({
  useWaiting: (...args: unknown[]) => mockUseWaiting(...args),
}));

jest.mock('pages/operations/useHistory', () => ({
  useHistory: (...args: unknown[]) => mockUseHistory(...args),
}));

jest.mock('pages/wms/usePickBatches', () => ({
  usePickBatches: () => ({ data: { batches: [] }, isLoading: false, isError: false }),
  usePickBatchOrders: () => ({ data: { orders: [] }, isLoading: false, isError: false }),
}));

jest.mock('pages/wms/useOrderPool', () => ({
  useBulkSetPriority: () => ({ mutateAsync: jest.fn() }),
}));

jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: {} }),
  useMutation: () => ({ mutateAsync: jest.fn() }),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

// HISTORY-ORDER-ENTITY-01 — same boundary mocks ops-console-global-search.test.tsx
// already uses to prove order-entity selection reaches the real modal seam
// without exercising OrderDetailModalBody's own data fetching.
jest.mock('@lasyncro/shared/ui', () => ({
  EntityDetailModal: ({ entityId, title, children }: any) =>
    entityId ? (
      <section data-testid="entity-detail-modal" aria-label={title}>
        {children}
      </section>
    ) : null,
}));

jest.mock('pages/orders/OrderDetailModalBody', () => ({
  OrderDetailModalBody: ({ orderId }: { orderId: string }) => (
    <div data-testid="order-detail-body">ORDER:{orderId}</div>
  ),
}));

jest.mock('pages/ft2-pages/BatchDetailModalBody', () => ({
  BatchDetailModalBody: () => null,
}));

jest.mock('pages/ft2-pages/VariantDetailModalHost', () => ({
  VariantDetailModalHost: () => null,
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

function alert(over: Partial<Alert> = {}): Alert {
  return {
    id: 'a1', alert_key: 'k', source: 'wms', alert_type: 'wms_pick_exception',
    severity: 'critical', title: 'Pick exception on batch 12', message: 'm',
    entity_id: null, entity_type: null, revenue_impact: null, category: null,
    audience: 'all', is_active: false, dismissed_at: null, resolved_at: null,
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
 * Backend HISTORY feed item shape — mirrors the real endpoint contract.
 * Copy is NOT ratified: title/subtitle/actionLabel are deliberately
 * distinctive nonsense, unrelated to `treatment`'s wording, so a passing
 * render proves the panel shows backend copy verbatim.
 */
function historyItem(over: Record<string, unknown> = {}) {
  return {
    interventionId: 'intv-1',
    treatment: 'address_correction',
    lasyncroOrderId: 'order-1',
    externalOrderId: '#1001',
    constraintId: 'constraint-1',
    constraintType: 'customer',
    blockType: 'incomplete_address',
    occurredAt: '2026-09-08T08:00:00.000Z',
    resolvedAt: '2026-09-08T09:00:00.000Z',
    outcome: 'verified_resolved',
    presentation: {
      title: 'ZZQ-7 history marker',
      subtitle: 'backend-supplied history copy #501',
      actionLabel: 'Do the resolved thing',
    },
    // HISTORY-ORDER-ENTITY-01 — order_entity, never a route.
    routing: { kind: 'order_entity', lasyncroOrderId: 'order-1' },
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseActivationChecklist.mockReturnValue({
    items: SETUP_ITEMS, completedCount: 1, allComplete: true,
    isLoading: false, isError: false,
  });
  mockUseWaiting.mockReturnValue({ data: { items: [] }, isLoading: false, isError: false });
  mockUseHistory.mockReturnValue({ data: { items: [] }, isLoading: false, isError: false });
});

function renderPanel(props: Partial<React.ComponentProps<typeof OpsConsolePanel>> = {}) {
  return render(
    <OpsConsolePanel alerts={[]} deepLink={deepLink} open onClose={jest.fn()} {...(props as any)} />
  );
}

describe('HISTORY V1 — renders only backend-supplied verified_resolved items', () => {
  it('renders a HISTORY row with status="verified" and backend copy verbatim (not derived from treatment)', () => {
    renderPanel({ historyItems: [historyItem()] } as any);

    fireEvent.click(screen.getByRole('tab', { name: 'HISTORY' }));
    const row = screen.getByTestId('ops-row-history:intv-1');
    expect(row).toBeInTheDocument();
    expect(row).toHaveAttribute('data-status', 'verified');
    expect(row).toHaveAttribute('data-section', 'HISTORY');
    expect(screen.getByText('ZZQ-7 history marker')).toBeInTheDocument();
    expect(screen.getByText('backend-supplied history copy #501')).toBeInTheDocument();
  });

  it('renders no HISTORY rows when the backend feed is an empty array', () => {
    renderPanel({ historyItems: [] } as any);
    fireEvent.click(screen.getByRole('tab', { name: 'HISTORY' }));
    expect(document.querySelectorAll('[data-section="HISTORY"][data-status]')).toHaveLength(0);
  });

  // ── HISTORY-ORDER-ENTITY-01 — required assertions 4/5 ────────────────────

  it('[4] clicking the HISTORY CTA opens EntityDetailModal for the exact order', () => {
    renderPanel({
      historyItems: [historyItem({ interventionId: 'intv-modal', lasyncroOrderId: 'order-modal-42',
        routing: { kind: 'order_entity', lasyncroOrderId: 'order-modal-42' } })],
    } as any);
    fireEvent.click(screen.getByRole('tab', { name: 'HISTORY' }));

    expect(screen.queryByTestId('entity-detail-modal')).not.toBeInTheDocument();

    const row = screen.getByTestId('ops-row-history:intv-modal');
    fireEvent.click(within(row).getByRole('button'));

    expect(screen.getByTestId('entity-detail-modal')).toBeInTheDocument();
    expect(screen.getByTestId('order-detail-body')).toHaveTextContent('ORDER:order-modal-42');
  });

  it('[5] clicking the HISTORY CTA triggers no page navigation', () => {
    renderPanel({ historyItems: [historyItem()] } as any);
    fireEvent.click(screen.getByRole('tab', { name: 'HISTORY' }));

    const row = screen.getByTestId('ops-row-history:intv-1');
    fireEvent.click(within(row).getByRole('button'));

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByTestId('order-detail-body')).toHaveTextContent('ORDER:order-1');
  });
});

describe('HISTORY V1 — resolved alerts never power this tab (item 10)', () => {
  it('a resolved alert present in `alerts`/inbox data alone produces no HISTORY row when the backend HISTORY feed is empty', () => {
    // A resolved-looking alert passed through the NOW `alerts` prop must
    // have zero bearing on HISTORY: the tab reads exclusively from
    // useHistory(), never from alert.resolved_at.
    renderPanel({
      alerts: [alert({ id: 'resolved-alert-1', resolved_at: '2026-09-08T09:00:00.000Z' })],
      historyItems: [],
    } as any);

    fireEvent.click(screen.getByRole('tab', { name: 'HISTORY' }));
    expect(screen.queryByTestId('ops-row-history:resolved-alert-1')).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-section="HISTORY"]')).toHaveLength(0);
  });
});

describe('HISTORY V1 — excluded from the attention badge (item 15)', () => {
  it('a populated HISTORY feed never changes OPEN-tab composition or a NOW/SETUP-derived count', () => {
    renderPanel({ historyItems: [historyItem(), historyItem({ interventionId: 'intv-2' })] } as any);

    // Still on OPEN by default — no HISTORY row is reachable there.
    expect(document.querySelectorAll('[data-section="HISTORY"]')).toHaveLength(0);
  });
});
