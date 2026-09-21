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
// Per the brief's IMPORTANT COMPOSITION RULE, this suite does NOT touch the
// existing triage-first fallback (criticalGroups) except to prove it is
// UNCHANGED (Contract 5's second half) — operational-lifecycle
// reconciliation belongs in the mapContent / Live Intelligence rail path
// only.
//
// Because no DOM structure exists yet for "Needs a decision" / "Verifying" /
// "Just resolved" per-order rows in the rail (today's rail only renders
// GROUP summaries — "N Address issues" — never individual order rows or
// glyphs), these tests are deliberately structure-agnostic: they assert on
// the total count of each lifecycle glyph ('!', '◌', '✓') anywhere in the
// rendered output, plus presence/absence of the section vocabulary named by
// the brief ("Needs a decision", "Verifying", "Just resolved"). This proves
// the CONTRACT without presupposing a DOM shape the brief explicitly says
// not to implement yet.
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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

/** Structure-agnostic glyph count — see file header. */
function glyphCount(container: HTMLElement, glyph: '!' | '◌' | '✓'): number {
  return (container.textContent?.match(new RegExp(glyph, 'g')) ?? []).length;
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
  it('renders exactly one actionable "!" representation, no duplicate, for an order with both an existing constraint and an attention episode', () => {
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

    // RED today: nothing consumes operationalEpisodeVisuals yet, so the
    // glyph never renders at all (count is 0, not 1).
    expect(glyphCount(container, '!')).toBe(1);
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

  it('D2B-GREEN FOLLOW-UP — a supported ATTENTION episode is admitted into Needs a decision even when absent from constrainedOrders/agingOrders entirely (canonical lifecycle independence)', () => {
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
    expect(glyphCount(container, '!')).toBe(1);
    expect(glyphCount(container, '◌')).toBe(0);
    expect(glyphCount(container, '✓')).toBe(0);

    fireEvent.click(screen.getByText(/Address issues/i));
    expect(onOrderClick).toHaveBeenCalledWith('order-attention-only');
    expect(mockNavigate).not.toHaveBeenCalledWith('/orders/flow');
  });
});

describe('D2B-RED Contract 2 — VERIFYING suppresses re-action, not the order (item 2)', () => {
  it('a verifying-only order is never counted as "!"-actionable and renders in a quieter Verifying context with "◌"', () => {
    const props = baseProps({
      mapContent: <div>map</div>,
      operationalEpisodeVisuals: [verifyingVisual('order-verifying-1')],
    });

    const { container } = renderModule(props);

    // RED today: no Verifying section/glyph exists at all.
    expect(glyphCount(container, '◌')).toBe(1);
    expect(glyphCount(container, '!')).toBe(0);
    expect(screen.queryByText(/Verifying/i)).toBeInTheDocument();
  });

  it('a verifying order backed by an existing constrained-orders row is NOT counted in "Needs a decision"', () => {
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

    // RED today: the module has no notion of "verifying" at all, so the
    // existing constrained-orders admission still counts this order under
    // "Needs a decision" ("Out of stock" / "!") unconditionally.
    expect(glyphCount(container, '!')).toBe(0);
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
  it('a just_resolved-only order never counts as "!"-actionable and renders in a transient Just-resolved context with "✓"', () => {
    const props = baseProps({
      mapContent: <div>map</div>,
      operationalEpisodeVisuals: [justResolvedVisual('order-resolved-1')],
    });

    const { container } = renderModule(props);

    // RED today: no Just-resolved section/glyph exists at all.
    expect(glyphCount(container, '✓')).toBe(1);
    expect(glyphCount(container, '!')).toBe(0);
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
  it('an order with both an attention episode and a verifying sibling episode renders once, and remains "!"-actionable', () => {
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

    // RED today: glyph never renders regardless of dominance.
    expect(glyphCount(container, '!')).toBe(1);
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
    expect(glyphCount(container, '!')).toBe(0);
    expect(glyphCount(container, '◌')).toBe(0);
    expect(glyphCount(container, '✓')).toBe(0);

    fireEvent.click(screen.getByText(/Address issues/i));
    expect(onOrderClick).toHaveBeenCalledWith('order-legacy-1');
  });

  it('with no mapContent, the triage-first compatibility layout is unaffected by operationalEpisodeVisuals', () => {
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
      // mapContent deliberately omitted -> fallback triage-first grid.
    });

    renderModule(props);

    expect(screen.getByRole('button', { name: /Address issues/i })).toBeInTheDocument();
    // The fallback grid must not read operationalEpisodeVisuals either.
    expect(screen.queryByText(/Verifying/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Just resolved/i)).not.toBeInTheDocument();
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
    // as a generic "!" row.
    expect(glyphCount(container, '!')).toBe(0);
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
  it('a customer/incomplete_address row is NOT rendered under Needs a decision while lifecycle is unresolved (null)', () => {
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
    expect(glyphCount(container, '!')).toBe(0);
    expect(screen.getByText(/Checking operational state/i)).toBeInTheDocument();
    expect(screen.queryByText(/all orders on track/i)).not.toBeInTheDocument();
  });
});

describe('D2C-RED Contract 4 — UNRESOLVED OVERSELL (item 4)', () => {
  it('an inventory/oversell row is NOT rendered under Needs a decision while lifecycle is unresolved (null)', () => {
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
    expect(glyphCount(container, '!')).toBe(0);
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
    expect(glyphCount(container, '!')).toBe(0);

    fireEvent.click(screen.getByText(/Address issues/i));
    expect(onOrderClick).toHaveBeenCalledWith('order-undefined-prop');
  });
});

describe('D2C-RED Contract 7 — NO-MAP COMPATIBILITY (item 7)', () => {
  it('the no-mapContent triage-first layout does not adopt D2C readiness gating when operationalEpisodeVisuals=null', () => {
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
      // mapContent deliberately omitted -> fallback triage-first grid.
    });

    renderModule(props);

    expect(screen.getByRole('button', { name: /Address issues/i })).toBeInTheDocument();
    expect(screen.queryByText(/Checking operational state/i)).not.toBeInTheDocument();
  });
});
