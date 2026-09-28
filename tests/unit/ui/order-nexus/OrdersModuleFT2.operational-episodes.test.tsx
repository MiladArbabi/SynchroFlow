// tests/unit/ui/order-nexus/OrdersModuleFT2.operational-episodes.test.tsx
//
// D2B-RED — CONTRACTS 1-6: operational-episode lifecycle reconciliation in
// the Live Intelligence (mapContent) rail path.
//
// SCOPE: this suite exercises OrdersModuleFT2's newly-declared
// `operationalEpisodeVisuals?: readonly OrdersOperationalEpisodeVisualInput[]
// | null` prop (declaration-only — see OrdersModuleFT2.tsx). NO rendering
// behavior has been implemented for it yet, so every "new behavior" contract
// (1-4) below is expected to fail RED. Contracts 5/6 are REGRESSION GUARDS —
// they assert what must remain true both before and after implementation,
// and are expected to already PASS today (nothing has been removed or
// broken; the new prop is simply not consumed yet).
//
// Operational-lifecycle reconciliation belongs in the Orders rail path. The
// no-mapContent cases (Contract 5's second half, D2C Contract 7) only prove
// the old triage-first fallback is not resurrected.
//
// Lifecycle state is asserted through the contextual lifecycle vocabulary
// ("Verifying", "Just resolved", "Checking operational state") and the
// count of lifecycle glyphs ('◌', '✓') anywhere in the rendered output.
//
// SCREEN-ARCH: the rail is Order health (state/orientation), not a
// "Needs a decision" inbox, and Ops Console owns actionable attention.
// ATTENTION is proven semantically — the order is represented exactly once
// in Order health's "Constraints & aging" state (constraintStateRows) — never
// by counting a literal "!" label suffix, which is presentation only. The
// no-map input keeps the same Orders screen identity rather than the old
// triage-first dashboard.
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import OrdersModuleFT2, {
  type OrdersOperationalEpisodeVisualInput,
} from '../../../../modules/order-nexus/src/ui/pages/OrdersModuleFT2';
import type { OrdersOperationalVisual } from '../../../../apps/frontend/src/pages/orders/ordersOperationalEpisodeVisual';

const mockNavigate = jest.fn();

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

jest.mock('@lasyncro/shared/ui', () => {
  const ReactLib = require('react');
  return {
    formatCurrencyCompact: (value: number) => `$${value.toLocaleString()}`,
    PulseCard: ({ title }: any) => ReactLib.createElement('section', {}, title),
    ReorderTransitionList: ({ children }: any) => ReactLib.createElement(ReactLib.Fragment, {}, children),
    // Composition-only double: primary always, rail unless suppressed.
    OperationalContextShell: ({ primary, rail, suppressRail }: any) =>
      ReactLib.createElement(ReactLib.Fragment, {}, primary, suppressRail ? null : rail),
  };
});

type Props = React.ComponentProps<typeof OrdersModuleFT2>;

function baseProps(overrides: Partial<Props> = {}): Props {
  const base = {
    context: {},
    timeseries: null,
    distribution: null,
    orders: { total: 1, fulfilled: 0, unfulfilled: 1, constrained: 0 },
    revenue: { totalSales: 100, earned: 0, pending: 100, blocked: 0 },
    operationalControl: {
      snapshot_date: new Date().toISOString(),
      aggregate_version: 1,
      realized_revenue: 0,
      at_risk_revenue: 0,
      total_at_risk_revenue: 0,
      sla_breach_24h_revenue: 0,
      top_blocking_type: 'customer',
      blocked_revenue: 0,
      revenue_leakage: 0,
      avg_contribution_margin_pct: 0,
      orders_at_sla_risk: 0,
      aging_24h: 0,
      aging_48h: 0,
      aging_72h_plus: 0,
      pending_fulfillment: 0,
      pending_payment: 0,
      exception_orders: 0,
      constrained_orders: 0,
      revenue_blocked_inventory: 0,
      revenue_blocked_customer: 0,
      revenue_blocked_operational: 0,
      queue_manual_review: 0,
      queue_awaiting_inventory: 0,
      queue_ready_to_ship: 0,
      queue_awaiting_customer: 0,
      partial_fulfillment_opportunity: 0,
    },
    decision: { brief: null },
    operatorSummary: {
      constraintCounts: { inventory: 0, customer: 0, operational: 0 },
      topBlockingType: null,
      agingOrders: [],
      imminentSlaBreachers: [],
      queueCounts: { readyToShip: 0, awaitingInventory: 0, awaitingCustomer: 0, manualReview: 0 },
    },
    constrainedOrders: [],
  } as unknown as Props;

  return { ...base, ...overrides } as Props;
}

function renderModule(props: Props) {
  return render(<OrdersModuleFT2 {...props} />);
}

/** Structure-agnostic lifecycle glyph count — see file header. */
function glyphCount(container: HTMLElement, glyph: '◌' | '✓'): number {
  return (container.textContent?.match(new RegExp(glyph, 'g')) ?? []).length;
}

/**
 * Rows in Order health's "Constraints & aging" state matching `label`.
 * Attention is proven by constraint-state membership, not by a "!" count.
 */
function constraintStateRows(label: RegExp): HTMLElement[] {
  const group = screen.queryByRole('group', { name: 'Constraints & aging' });
  return group ? within(group).queryAllByText(label) : [];
}

function attentionVisual(
  orderId: string,
  overrides: Partial<OrdersOperationalEpisodeVisualInput> = {}
): OrdersOperationalEpisodeVisualInput {
  return {
    orderId,
    state: 'critical',
    glyph: '!',
    episodeCount: 1,
    dominant: { lifecycle: 'attention', problem: { domain: 'customer', type: 'incomplete_address' } },
    ...overrides,
  };
}

function verifyingVisual(
  orderId: string,
  overrides: Partial<OrdersOperationalEpisodeVisualInput> = {}
): OrdersOperationalEpisodeVisualInput {
  return {
    orderId,
    state: 'active',
    glyph: '◌',
    episodeCount: 1,
    dominant: { lifecycle: 'verifying', problem: { domain: 'inventory', type: 'oversell' } },
    ...overrides,
  };
}

function justResolvedVisual(
  orderId: string,
  overrides: Partial<OrdersOperationalEpisodeVisualInput> = {}
): OrdersOperationalEpisodeVisualInput {
  return {
    orderId,
    state: 'healthy',
    glyph: '✓',
    episodeCount: 1,
    dominant: { lifecycle: 'just_resolved', problem: { domain: 'customer', type: 'incomplete_address' } },
    ...overrides,
  };
}

describe('OrdersModuleFT2 — D2B-RED structural type compatibility', () => {
  it('accepts the real D2A OrdersOperationalVisual[] verbatim as operationalEpisodeVisuals, with no adapter mapping', () => {
    // Compile-time proof, not a runtime assertion: if this file compiles,
    // OrdersOperationalVisual[] (apps/frontend, D2A) is structurally
    // assignable to OrdersOperationalEpisodeVisualInput[] (order-nexus,
    // D2B) as-is.
    const d2aVisual: OrdersOperationalVisual = {
      orderId: 'order-compat',
      state: 'critical',
      glyph: '!',
      episodeCount: 1,
      dominant: {
        episodeId: 'ep-1',
        lifecycle: 'attention',
        severity: 'critical',
        problem: { domain: 'customer', type: 'incomplete_address' },
        blocking: true,
        primaryEntity: { kind: 'order', id: 'order-compat' },
        affectedEntities: [{ kind: 'order', id: 'order-compat' }],
        spatialContext: [],
        actionTarget: { kind: 'entity', entity: { kind: 'order', id: 'order-compat' } },
        occurredAt: '2026-09-21T09:00:00.000Z',
      },
      episodes: [],
    };
    const assignedDirectly: readonly OrdersOperationalEpisodeVisualInput[] = [d2aVisual];
    expect(assignedDirectly[0].orderId).toBe('order-compat');
  });
});

describe('D2B-RED Contract 1 — ATTENTION + existing constraint (item 1)', () => {
  it('represents an order with both an existing constraint and an attention episode exactly once in constraint state, no duplicate', () => {
    const onOrderClick = jest.fn();
    const props = baseProps({
      mapContent: <div>map</div>,
      onOrderClick,
      constrainedOrders: [
        {
          order_id: 'order-attn-1',
          external_order_id: '1001',
          constraint_type: 'customer',
          block_type: 'incomplete_address',
          revenue: 100,
          age_since_creation_seconds: 0,
          is_shipping_sla_breached: false,
        },
      ],
      operationalEpisodeVisuals: [attentionVisual('order-attn-1')],
    });

    const { container } = renderModule(props);

    // One constraint-state representation; no lifecycle-context duplicate.
    expect(constraintStateRows(/Address issues/)).toHaveLength(1);
    expect(glyphCount(container, '◌')).toBe(0);
    expect(glyphCount(container, '✓')).toBe(0);
  });

  it('a single-order attention group still opens onOrderClick(orderId) (existing click wiring preserved)', () => {
    const onOrderClick = jest.fn();
    const props = baseProps({
      mapContent: <div>map</div>,
      onOrderClick,
      constrainedOrders: [
        {
          order_id: 'order-attn-2',
          external_order_id: '1002',
          constraint_type: 'customer',
          block_type: 'incomplete_address',
          revenue: 100,
          age_since_creation_seconds: 0,
          is_shipping_sla_breached: false,
        },
      ],
      operationalEpisodeVisuals: [attentionVisual('order-attn-2')],
    });

    renderModule(props);

    // Pre-existing rail-row click affordance (railGroups single-order path).
    const decisionRow = screen.getByText(/Address issues/i);
    fireEvent.click(decisionRow);

    expect(onOrderClick).toHaveBeenCalledWith('order-attn-2');
  });

  it('D2B-GREEN FOLLOW-UP — a supported ATTENTION episode is classified as attention even when absent from constrainedOrders/agingOrders entirely (canonical lifecycle independence)', () => {
    const onOrderClick = jest.fn();
    const props = baseProps({
      mapContent: <div>map</div>,
      onOrderClick,
      // Deliberately empty — the legacy populations do NOT contain this
      // order at all. Canonical operational-episode truth must not depend
      // on either independently containing the same order.
      constrainedOrders: [],
      operationalEpisodeVisuals: [attentionVisual('order-attention-only')],
    });

    const { container } = renderModule(props);

    expect(screen.getByText(/Address issues/i)).toBeInTheDocument();
    expect(constraintStateRows(/Address issues/)).toHaveLength(1);
    expect(glyphCount(container, '◌')).toBe(0);
    expect(glyphCount(container, '✓')).toBe(0);

    fireEvent.click(screen.getByText(/Address issues/i));
    expect(onOrderClick).toHaveBeenCalledWith('order-attention-only');
    expect(mockNavigate).not.toHaveBeenCalledWith('/orders/flow');
  });
});

describe('D2B-RED Contract 2 — VERIFYING suppresses re-action, not the order (item 2)', () => {
  it('a verifying-only order is never in constraint state and renders in a quieter Verifying context with "◌"', () => {
    const props = baseProps({
      mapContent: <div>map</div>,
      operationalEpisodeVisuals: [verifyingVisual('order-verifying-1')],
    });

    const { container } = renderModule(props);

    // RED today: no Verifying section/glyph exists at all.
    expect(glyphCount(container, '◌')).toBe(1);
    expect(constraintStateRows(/Out of stock/)).toHaveLength(0);
    expect(screen.queryByText(/Verifying/i)).toBeInTheDocument();
  });

  it('a verifying order backed by an existing constrained-orders row is NOT classified as attention', () => {
    const props = baseProps({
      mapContent: <div>map</div>,
      constrainedOrders: [
        {
          order_id: 'order-verifying-2',
          external_order_id: '2002',
          constraint_type: 'inventory',
          block_type: 'oversell',
          revenue: 100,
          age_since_creation_seconds: 0,
          is_shipping_sla_breached: false,
        },
      ],
      operationalEpisodeVisuals: [verifyingVisual('order-verifying-2')],
    });

    const { container } = renderModule(props);

    // The existing constrained-orders admission must not re-surface this
    // order as attention ("Out of stock" constraint state) while it is verifying.
    expect(constraintStateRows(/Out of stock/)).toHaveLength(0);
    expect(glyphCount(container, '◌')).toBe(1);
  });

  it('a multi-order verifying context never navigates to /orders/flow', () => {
    const props = baseProps({
      mapContent: <div>map</div>,
      operationalEpisodeVisuals: [
        verifyingVisual('order-verifying-3'),
        verifyingVisual('order-verifying-4'),
      ],
    });

    const { container } = renderModule(props);

    // Click anything rendered for the verifying context, if anything is
    // rendered at all — today nothing is, so this is a smoke guard against
    // an accidental Order-Flow navigation shortcut being taken later.
    const verifyingText = screen.queryByText(/Verifying/i);
    if (verifyingText) fireEvent.click(verifyingText);

    expect(mockNavigate).not.toHaveBeenCalledWith('/orders/flow');
    void container;
  });
});

describe('D2B-RED Contract 3 — JUST_RESOLVED (item 3)', () => {
  it('a just_resolved-only order is never in constraint state and renders in a transient Just-resolved context with "✓"', () => {
    const props = baseProps({
      mapContent: <div>map</div>,
      operationalEpisodeVisuals: [justResolvedVisual('order-resolved-1')],
    });

    const { container } = renderModule(props);

    // RED today: no Just-resolved section/glyph exists at all.
    expect(glyphCount(container, '✓')).toBe(1);
    expect(constraintStateRows(/Address issues/)).toHaveLength(0);
    expect(screen.queryByText(/Just resolved/i)).toBeInTheDocument();
  });

  it('never navigates to Order Flow from the just_resolved context', () => {
    const props = baseProps({
      mapContent: <div>map</div>,
      operationalEpisodeVisuals: [justResolvedVisual('order-resolved-2')],
    });

    renderModule(props);

    const resolvedText = screen.queryByText(/Just resolved/i);
    if (resolvedText) fireEvent.click(resolvedText);

    expect(mockNavigate).not.toHaveBeenCalledWith('/orders/flow');
  });
});

describe('D2B-RED Contract 4 — mixed episodes same order, attention wins (item 4)', () => {
  it('an order with both an attention episode and a verifying sibling episode renders once, and remains in constraint state', () => {
    const props = baseProps({
      mapContent: <div>map</div>,
      constrainedOrders: [
        {
          order_id: 'order-mixed-1',
          external_order_id: '4001',
          constraint_type: 'customer',
          block_type: 'incomplete_address',
          revenue: 100,
          age_since_creation_seconds: 0,
          is_shipping_sla_breached: false,
        },
      ],
      // D1/D2A precedence already resolves ONE dominant per order — attention
      // beats verifying/just_resolved (resolveDominantEpisode). The module
      // receives only the already-dominant-resolved visual, never siblings
      // directly, matching D1's own aggregate.dominant contract.
      operationalEpisodeVisuals: [attentionVisual('order-mixed-1')],
    });

    const { container } = renderModule(props);

    // Attention dominance: one constraint-state row, no Verifying duplicate.
    expect(constraintStateRows(/Address issues/)).toHaveLength(1);
    expect(glyphCount(container, '◌')).toBe(0);
    expect(glyphCount(container, '✓')).toBe(0);
  });
});

describe('D2B-RED Contract 5 — legacy fallback is unchanged (item 5)', () => {
  it('with no operationalEpisodeVisuals, the Live Intelligence rail renders exactly as before (no glyphs, existing group behavior intact)', () => {
    const onOrderClick = jest.fn();
    const props = baseProps({
      mapContent: <div>map</div>,
      onOrderClick,
      constrainedOrders: [
        {
          order_id: 'order-legacy-1',
          external_order_id: '5001',
          constraint_type: 'customer',
          block_type: 'incomplete_address',
          revenue: 100,
          age_since_creation_seconds: 0,
          is_shipping_sla_breached: false,
        },
      ],
      // operationalEpisodeVisuals deliberately omitted.
    });

    const { container } = renderModule(props);

    expect(screen.getByText(/Address issues/i)).toBeInTheDocument();
    expect(constraintStateRows(/Address issues/)).toHaveLength(1);
    expect(glyphCount(container, '◌')).toBe(0);
    expect(glyphCount(container, '✓')).toBe(0);

    fireEvent.click(screen.getByText(/Address issues/i));
    expect(onOrderClick).toHaveBeenCalledWith('order-legacy-1');
  });

  it('with no mapContent, the Orders screen identity is kept and attention does not leak into Verifying / Just resolved', () => {
    const props = baseProps({
      constrainedOrders: [
        {
          order_id: 'order-legacy-2',
          external_order_id: '5002',
          constraint_type: 'customer',
          block_type: 'incomplete_address',
          revenue: 100,
          age_since_creation_seconds: 0,
          is_shipping_sla_breached: false,
        },
      ],
      operationalEpisodeVisuals: [attentionVisual('order-legacy-2')],
      // mapContent deliberately omitted — must not resurrect triage-first.
    });

    renderModule(props);

    expect(screen.getByText(/Address issues/i)).toBeInTheDocument();
    expect(screen.queryByText(/Verifying/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Just resolved/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Ranked by commercial consequence')).not.toBeInTheDocument();
    expect(screen.queryByText('Needs a decision')).not.toBeInTheDocument();
  });
});

describe('D2B-RED Contract 6 — returned_undelivered ownership regression (item 6)', () => {
  it('a returned_undelivered-shaped operational episode visual is never resurrected as an actionable row', () => {
    const props = baseProps({
      mapContent: <div>map</div>,
      operationalEpisodeVisuals: [
        attentionVisual('order-returned-1', {
          state: 'critical',
          dominant: { lifecycle: 'attention', problem: { domain: 'operational', type: 'returned_undelivered' } },
        }),
      ],
    });

    const { container } = renderModule(props);

    expect(screen.queryByText(/Package returned/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Package returned/i })).not.toBeInTheDocument();
    // Also guards against a future implementation accidentally admitting it
    // as a generic constraint-state row.
    expect(screen.queryByRole('group', { name: 'Constraints & aging' })).not.toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════
// D2C-RED — CANONICAL OPERATIONAL LIFECYCLE READINESS (component-level)
// ═════════════════════════════════════════════════════════════════════════
//
// Ratified prop semantics:
//   operationalEpisodeVisuals === undefined -> legacy/non-participating consumer, current behavior exactly
//   operationalEpisodeVisuals === null      -> canonical lifecycle UNRESOLVED, fail closed for V1 families only
//   operationalEpisodeVisuals === []        -> canonical query succeeded with no current episodes
//   operationalEpisodeVisuals === [visuals] -> normal D2B reconciliation
//
// No production behavior has been implemented for the `null` case yet —
// OrdersModuleFT2.tsx still treats `operationalEpisodeVisuals ?? []`
// identically for `null` and `undefined` (no distinction), so Contracts 3/4
// are expected to fail RED. Contracts 5/6/7 are regression guards for
// behavior that must survive once the fix lands — see D2B-RED Contract 5/6
// above for the `undefined`-path precedent these reuse.
describe('D2C-RED Contract 3 — UNRESOLVED ADDRESS (item 3)', () => {
  it('a customer/incomplete_address row is NOT rendered as attention while lifecycle is unresolved (null)', () => {
    const props = baseProps({
      mapContent: <div>map</div>,
      constrainedOrders: [
        {
          order_id: 'order-unresolved-addr-1',
          external_order_id: '3001',
          constraint_type: 'customer',
          block_type: 'incomplete_address',
          revenue: 100,
          age_since_creation_seconds: 0,
          is_shipping_sla_breached: false,
        },
      ],
      operationalEpisodeVisuals: null,
    });

    const { container } = renderModule(props);

    expect(screen.queryByText(/Address issues/i)).not.toBeInTheDocument();
    expect(constraintStateRows(/Address issues/)).toHaveLength(0);
    expect(screen.getByText(/Checking operational state/i)).toBeInTheDocument();
    expect(screen.queryByText(/all orders on track/i)).not.toBeInTheDocument();
  });
});

describe('D2C-RED Contract 4 — UNRESOLVED OVERSELL (item 4)', () => {
  it('an inventory/oversell row is NOT rendered as attention while lifecycle is unresolved (null)', () => {
    const props = baseProps({
      mapContent: <div>map</div>,
      constrainedOrders: [
        {
          order_id: 'order-unresolved-inv-1',
          external_order_id: '4001',
          constraint_type: 'inventory',
          block_type: 'oversell',
          revenue: 100,
          age_since_creation_seconds: 0,
          is_shipping_sla_breached: false,
        },
      ],
      operationalEpisodeVisuals: null,
    });

    const { container } = renderModule(props);

    expect(screen.queryByText(/Out of stock/i)).not.toBeInTheDocument();
    expect(constraintStateRows(/Out of stock/)).toHaveLength(0);
    expect(screen.getByText(/Checking operational state/i)).toBeInTheDocument();
    expect(screen.queryByText(/all orders on track/i)).not.toBeInTheDocument();
  });
});

describe('D2C-RED Contract 5 — UNRELATED LEGACY ROWS SURVIVE while unresolved (item 5)', () => {
  it('an SLA-only row and a non-V1 operational constraint remain represented normally when operationalEpisodeVisuals=null', () => {
    const props = baseProps({
      mapContent: <div>map</div>,
      operatorSummary: {
        constraintCounts: { inventory: 0, customer: 0, operational: 1 },
        topBlockingType: 'operational',
        agingOrders: [
          {
            lasyncro_order_id: 'order-sla-only',
            externalOrderId: '5101',
            ageHours: 80,
            isShippingSlaBreached: true,
            constraintType: null,
            blockType: null,
            isPriorityFlagged: false,
            inPickBatch: false,
            pickBatchStatus: null,
            revenue: 700,
            timeToSlaBreachMinutes: null,
          },
        ],
        imminentSlaBreachers: [],
        queueCounts: { readyToShip: 0, awaitingInventory: 0, awaitingCustomer: 0, manualReview: 1 },
      },
      constrainedOrders: [
        {
          order_id: 'order-non-v1-op',
          external_order_id: '5102',
          constraint_type: 'operational',
          block_type: 'manual_review_hold',
          revenue: 400,
          age_since_creation_seconds: 0,
          is_shipping_sla_breached: false,
        },
      ],
      operationalEpisodeVisuals: null,
    });

    renderModule(props);

    expect(screen.getByText(/Shipping SLA breached/i)).toBeInTheDocument();
    expect(screen.getByText(/Operational issues/i)).toBeInTheDocument();
  });
});

describe('D2C-RED Contract 6 — UNDEFINED preserves compatibility (item 6)', () => {
  it('an omitted operationalEpisodeVisuals prop keeps current legacy behavior exactly (no readiness gating)', () => {
    const onOrderClick = jest.fn();
    const props = baseProps({
      mapContent: <div>map</div>,
      onOrderClick,
      constrainedOrders: [
        {
          order_id: 'order-undefined-prop',
          external_order_id: '6001',
          constraint_type: 'customer',
          block_type: 'incomplete_address',
          revenue: 100,
          age_since_creation_seconds: 0,
          is_shipping_sla_breached: false,
        },
      ],
      // operationalEpisodeVisuals deliberately OMITTED (undefined).
    });

    const { container } = renderModule(props);

    expect(screen.getByText(/Address issues/i)).toBeInTheDocument();
    expect(screen.queryByText(/Checking operational state/i)).not.toBeInTheDocument();
    expect(constraintStateRows(/Address issues/)).toHaveLength(1);

    fireEvent.click(screen.getByText(/Address issues/i));
    expect(onOrderClick).toHaveBeenCalledWith('order-undefined-prop');
  });
});

describe('D2C-RED Contract 7 — NO-MAP IDENTITY (item 7)', () => {
  // SCREEN-ARCH: the no-map input no longer has a separate triage-first
  // layout to exempt from readiness gating. This case now proves only that
  // the unresolved (null) lifecycle input does not resurrect that layout.
  // Whether no-map null input gates V1 families like the map path is not
  // asserted here.
  it('the no-mapContent input does not resurrect the triage-first layout when operationalEpisodeVisuals=null', () => {
    const props = baseProps({
      constrainedOrders: [
        {
          order_id: 'order-nomap-null',
          external_order_id: '7001',
          constraint_type: 'customer',
          block_type: 'incomplete_address',
          revenue: 100,
          age_since_creation_seconds: 0,
          is_shipping_sla_breached: false,
        },
      ],
      operationalEpisodeVisuals: null,
      // mapContent deliberately omitted.
    });

    renderModule(props);

    expect(screen.queryByText('Ranked by commercial consequence')).not.toBeInTheDocument();
    expect(screen.queryByText('Needs a decision')).not.toBeInTheDocument();
    expect(screen.queryByText(/Prioritize/i)).not.toBeInTheDocument();
  });
});
