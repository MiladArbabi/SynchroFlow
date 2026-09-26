// tests/unit/ui/overview/OverviewModuleFT2.ov-v1-operations-pulse.test.tsx
//
// OV-V1-0 — Overview v1 ownership + Operations Pulse (module).
//
// OVERVIEW-SCREEN-OPT-01 (Slice A): the V1 composition is the single
// canonical renderer and operationsPulse is a required prop. There is no
// fallback triage / Business Pulse renderer; with no mapContent the module
// renders the pulse-only state.
//
// Overview is whole-operation situational awareness.
//
// Out of scope for this file: every Overview Ops Console behaviour
// ("Open Ops Console" presence/absence, onOpenOpsConsole wiring). That is
// owned and protected exclusively by GH-1153's own tests.
//
// TARGET MODULE CONTRACT (bounded prop naming chosen by this contract):
//
//   operationsPulse: {
//     orders:      { readyCount, blockedCount, blockedRevenue,
//                    pastSlaCount, pastSlaRevenue },
//     fulfillment: { activeBatchCount, pickingBatchCount, packingBatchCount },
//     inventory:   { awaitingInventoryCount, awaitingInventoryRevenue },
//     inbound:     { receiveAtDockUnits, awaitingStowUnits },
//   }
//
// Rendered as an accessible region named "Operations pulse" containing one
// accessible group per domain (Orders, Fulfillment, Inventory, Inbound).
// Returns is OMITTED from v1.
//
// All counts/values are STRUCTURED props. The module must never derive them
// from Morning Brief / alert title or message copy — hostile Morning Brief
// fixtures below carry contradictory numbers to prove that.
//
// What is protected: ownership, domain semantics, structured truth,
// accessibility of the region/groups/controls. What is deliberately NOT
// protected: exact copy, CSS, layout, DOM nesting beyond region → group.

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { formatCurrencyCompact } from '@lasyncro/shared/ui';
import OverviewModuleFT2, {
  type OverviewModuleFT2Props,
} from '../../../../modules/overview/src/ui/pages/OverviewModuleFT2';

// ─── CONTRACT SHAPE ─────────────────────────────────────────────────────────

interface OperationsPulseV1 {
  orders: {
    readyCount: number;
    blockedCount: number;
    blockedRevenue: number;
    pastSlaCount: number;
    pastSlaRevenue: number;
  };
  fulfillment: {
    activeBatchCount: number;
    pickingBatchCount: number;
    packingBatchCount: number;
  };
  inventory: {
    awaitingInventoryCount: number;
    awaitingInventoryRevenue: number;
  };
  inbound: {
    receiveAtDockUnits: number;
    awaitingStowUnits: number;
  };
}

// Structured truth. Numbers are chosen to be mutually distinct so a value
// leaking into the wrong domain group is detectable.
//   ready 8 (eligible pool would be 99 — never shown)
//   blocked 9 / $1,250 (operational snapshot constrained_orders / blocked_revenue)
//   past SLA 27 / $5,400 (readCurrentFulfillmentSlaSummary breachedCount / breachedRevenue)
//   awaiting inventory 2 / $600 (queue_awaiting_inventory / revenue_blocked_inventory)
//   active batches 3 (2 picking, 1 packing)
//   inbound 5 at dock, 12 awaiting stow
function pulseFixture(overrides: Partial<OperationsPulseV1> = {}): OperationsPulseV1 {
  return {
    orders: {
      readyCount: 8,
      blockedCount: 9,
      blockedRevenue: 1250,
      pastSlaCount: 27,
      pastSlaRevenue: 5400,
    },
    fulfillment: { activeBatchCount: 3, pickingBatchCount: 2, packingBatchCount: 1 },
    inventory: { awaitingInventoryCount: 2, awaitingInventoryRevenue: 600 },
    inbound: { receiveAtDockUnits: 5, awaitingStowUnits: 12 },
    ...overrides,
  };
}

// Hostile Morning Brief: titles/messages carry numbers that contradict the
// structured truth. Five signals would have exceeded the retired decision
// rail's three-row preview ("+2 more").
const HOSTILE_SIGNALS = [
  {
    id: 'sla',
    priority: 1 as const,
    title: '999 orders past SLA',
    detail: '999 orders are past their fulfillment SLA.',
    module: 'order-nexus',
    deepLink: '/orders/flow?urgency=sla_breach',
    revenueImpact: 99900,
    alertType: 'sla_breach',
  },
  {
    id: 'blocked',
    priority: 1 as const,
    title: '40 orders blocked',
    detail: '40 orders cannot ship.',
    module: 'orders',
    deepLink: '/orders/blocked',
    revenueImpact: 77777,
    alertType: 'revenue_at_risk',
  },
  {
    id: 'inventory',
    priority: 2 as const,
    title: '11 orders awaiting inventory',
    detail: 'Stock is short.',
    module: 'inventory',
    deepLink: '/inventory',
    revenueImpact: 3333,
  },
  {
    id: 'address',
    priority: 3 as const,
    title: '4 orders with address issues',
    detail: 'Fix addresses.',
    module: 'overview',
    deepLink: '/overview?resolution=address',
    revenueImpact: 444,
  },
  {
    id: 'reorder',
    priority: 4 as const,
    title: '6 SKUs below reorder point',
    detail: 'Reorder.',
    module: 'demand',
    deepLink: '/demand?filter=critical',
    revenueImpact: 666,
  },
];

function baseProps(): OverviewModuleFT2Props {
  return {
    trust: null,
    context: { ordersObserved: 10, productsObserved: 5, customersObserved: 3 },
    snapshot: { orders: null, products: null, customers: null },
    alignment: null,
    operationalWarningState: 'warning',
    currency: 'USD',
    pulse: {
      revenueToday: 1000,
      revenueDeltaVsYesterday: 0,
      atRiskRevenue: 200,
      blockedRevenue: 100,
      topBlockingType: null,
    },
    morningBrief: {
      signals: HOSTILE_SIGNALS,
      hasUrgentIssues: true,
      generatedAt: '2026-09-10T00:00:00.000Z',
      trustWarning: false,
      greeting: null,
      summaryLine: null,
    },
    operationsPulse: pulseFixture(),
  };
}

function renderOverview(opts: {
  pulse?: OperationsPulseV1;
  map?: boolean;
  onNavigate?: jest.Mock;
} = {}) {
  const { pulse = pulseFixture(), map = true, onNavigate = jest.fn() } = opts;
  render(
    <OverviewModuleFT2
      {...baseProps()}
      operationsPulse={pulse}
      onNavigate={onNavigate}
      mapContent={map ? <div data-testid="map-slot" /> : undefined}
    />
  );
  return { onNavigate };
}

function operationsPulse() {
  return screen.getByRole('region', { name: /operations pulse/i });
}

function domainGroup(name: RegExp) {
  return within(operationsPulse()).getByRole('group', { name });
}

const ORDERS = /^orders\b/i;
const FULFILLMENT = /^fulfil{1,2}ment\b/i;
const INVENTORY = /^inventory\b/i;
const INBOUND = /^inbound\b/i;

// Standalone-number match: `8` must not match inside "$1,250", "18" or "8.5".
function containsNumber(el: HTMLElement, n: number): boolean {
  return new RegExp(`(^|[^\\d.,])${n}([^\\d.,]|$)`).test(el.textContent ?? '');
}

const usd = (v: number) => formatCurrencyCompact(v, 'USD');

const LAYOUTS = [
  ['map layout', true],
  ['pulse-only state (no mapContent)', false],
] as const;

// ─── A — OVERVIEW OWNERSHIP ─────────────────────────────────────────────────

describe('OV-V1-0 (A): Overview ownership — situational awareness only', () => {
  it.each(LAYOUTS)('%s: renders none of the retired decision/revenue surfaces', (_label, map) => {
    // Supersedes OverviewModuleFT2.business-pulse.test.ts (OV-DATA-03 /
    // OV-REV-07): Business pulse, Revenue today, At risk and Collected today
    // are proven absent here by rendering, not by source scanning.
    renderOverview({ map });

    expect(screen.queryByText(/Needs a decision/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Business pulse/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Revenue today/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Collected today/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^At risk$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^\+\d+ more$/)).not.toBeInTheDocument();
  });

  it.each(LAYOUTS)('%s: does not duplicate the cross-domain decision queue (Morning Brief signal rows)', (_label, map) => {
    renderOverview({ map });

    for (const s of HOSTILE_SIGNALS) {
      expect(screen.queryByText(s.title)).not.toBeInTheDocument();
    }
  });

  it('map content remains present when supplied, alongside the Operations pulse', () => {
    renderOverview({ map: true });

    expect(screen.getByTestId('map-slot')).toBeInTheDocument();
    expect(operationsPulse()).toBeInTheDocument();
  });

  it('Operations pulse exposes Orders, Fulfillment, Inventory and Inbound — and omits Returns in v1', () => {
    renderOverview();

    expect(domainGroup(ORDERS)).toBeInTheDocument();
    expect(domainGroup(FULFILLMENT)).toBeInTheDocument();
    expect(domainGroup(INVENTORY)).toBeInTheDocument();
    expect(domainGroup(INBOUND)).toBeInTheDocument();
    expect(within(operationsPulse()).queryByRole('group', { name: /returns/i })).not.toBeInTheDocument();
    expect(within(operationsPulse()).queryByText(/returns?/i)).not.toBeInTheDocument();
  });
});

// ─── REQUIRED PROP ──────────────────────────────────────────────────────────
//
// Compile-time contract: babel-jest strips types, so this is proven by
// TypeScript (an unused @ts-expect-error is itself a type error).

describe('OVERVIEW-SCREEN-OPT-01: operationsPulse is required', () => {
  it('OverviewModuleFT2Props without operationsPulse is a type error', () => {
    const { operationsPulse: _omitted, ...withoutPulse } = baseProps();
    // @ts-expect-error — operationsPulse is a required prop.
    const invalid: OverviewModuleFT2Props = withoutPulse;
    expect(invalid).not.toHaveProperty('operationsPulse');
  });
});

// ─── B — READY TRUTH ────────────────────────────────────────────────────────

describe('OV-V1-0 (B): Ready uses ready_for_release_count, never eligible_order_count', () => {
  it.each(LAYOUTS)('%s: Orders shows 8 ready (not the 99-order eligible pool)', (_label, map) => {
    renderOverview({ map });

    const orders = domainGroup(ORDERS);
    expect(orders.textContent).toMatch(/ready/i);
    expect(containsNumber(orders, 8)).toBe(true);
    expect(containsNumber(orders, 99)).toBe(false);
  });
});

// ─── C — BLOCKED TRUTH ──────────────────────────────────────────────────────

describe('OV-V1-0 (C): Blocked count and commercial exposure are structured values', () => {
  it('Orders shows 9 blocked with $1,250 exposure, ignoring the hostile "40 orders blocked" brief copy', () => {
    renderOverview();

    const orders = domainGroup(ORDERS);
    expect(orders.textContent).toMatch(/blocked/i);
    expect(containsNumber(orders, 9)).toBe(true);
    expect(orders.textContent).toContain(usd(1250));

    expect(containsNumber(orders, 40)).toBe(false);
    expect(orders.textContent).not.toContain(usd(77777));
  });
});

// ─── D — PAST-SLA STRUCTURED CONTRACT ───────────────────────────────────────

describe('OV-V1-0 (D): Past-SLA is structured (readCurrentFulfillmentSlaSummary), never parsed from copy', () => {
  it('shows 27 past SLA with $5,400 exposure while the brief title claims "999 orders past SLA"', () => {
    renderOverview();

    const orders = domainGroup(ORDERS);
    expect(orders.textContent).toMatch(/SLA/i);
    expect(containsNumber(orders, 27)).toBe(true);
    expect(orders.textContent).toContain(usd(5400));

    const pulse = operationsPulse();
    expect(containsNumber(pulse, 999)).toBe(false);
    expect(pulse.textContent).not.toContain(usd(99900));
  });

  it('structured values drive the display: changing pastSlaCount changes the shown count, brief copy unchanged', () => {
    renderOverview({
      pulse: pulseFixture({
        orders: { ...pulseFixture().orders, pastSlaCount: 31, pastSlaRevenue: 7100 },
      }),
    });

    const orders = domainGroup(ORDERS);
    expect(containsNumber(orders, 31)).toBe(true);
    expect(orders.textContent).toContain(usd(7100));
    expect(containsNumber(orders, 27)).toBe(false);
    expect(containsNumber(operationsPulse(), 999)).toBe(false);
  });
});

// ─── E — INVENTORY SEMANTICS ────────────────────────────────────────────────

describe('OV-V1-0 (E): Inventory = awaiting inventory only', () => {
  it('shows 2 awaiting inventory — not constrained_orders (9) and not their sum (11)', () => {
    renderOverview();

    const inventory = domainGroup(INVENTORY);
    expect(inventory.textContent).toMatch(/awaiting|inventory/i);
    expect(containsNumber(inventory, 2)).toBe(true);
    expect(containsNumber(inventory, 9)).toBe(false);
    expect(containsNumber(inventory, 11)).toBe(false);
    expect(inventory.textContent).toContain(usd(600));

    // Generic constrained/blocked orders are not labelled as inventory problems.
    expect(inventory.textContent).not.toMatch(/constrained/i);
  });
});

// ─── FULFILLMENT ────────────────────────────────────────────────────────────

describe('OV-V1-0: Fulfillment shows active batches', () => {
  it('shows 3 active batches', () => {
    renderOverview();

    const fulfillment = domainGroup(FULFILLMENT);
    expect(fulfillment.textContent).toMatch(/batch/i);
    expect(containsNumber(fulfillment, 3)).toBe(true);
  });
});

// ─── F — INBOUND SEMANTICS ──────────────────────────────────────────────────

describe('OV-V1-0 (F): Inbound uses structured receive-at-dock and awaiting-stow', () => {
  it('non-zero: shows 5 at dock and 12 awaiting stow', () => {
    renderOverview();

    const inbound = domainGroup(INBOUND);
    expect(inbound.textContent).toMatch(/dock/i);
    expect(inbound.textContent).toMatch(/stow/i);
    expect(containsNumber(inbound, 5)).toBe(true);
    expect(containsNumber(inbound, 12)).toBe(true);
  });

  it('both zero: Inbound shows a Clear state', () => {
    renderOverview({
      pulse: pulseFixture({ inbound: { receiveAtDockUnits: 0, awaitingStowUnits: 0 } }),
    });

    const inbound = domainGroup(INBOUND);
    expect(inbound.textContent).toMatch(/clear/i);
    expect(containsNumber(inbound, 5)).toBe(false);
    expect(containsNumber(inbound, 12)).toBe(false);
  });
});

// ─── H — NO LOOSE ENDS (bounded) ────────────────────────────────────────────
//
// Informational, non-interactive rows are allowed; nothing here requires a
// control. The bounded invariant is only: IF something inside the Operations
// pulse is rendered as an interactive control, its observable destination
// must be specific — a non-empty href, or an onNavigate target — and never a
// generic self-route to "/" or "/overview".
//
// Deliberately NOT protected here (deferred to OV-V1-5, which owns the
// signal interaction API): exact final routes, dead-control detection for
// buttons whose action is not observable through onNavigate. Ops Console
// behaviour is not asserted here at all (GH-1153 owns it).

// Bare "/" or "/overview" only. A specific Overview intent such as
// "/overview?resolution=address" is not a generic self-route.
const GENERIC_SELF_ROUTE = /^\/(overview\/?)?$/;

describe('OV-V1-0 (H): Operations pulse controls never loose-end to a generic route', () => {
  it('every link has a specific href, and every onNavigate target is specific', () => {
    const { onNavigate } = renderOverview();
    const pulse = operationsPulse();

    for (const link of within(pulse).queryAllByRole('link')) {
      const href = link.getAttribute('href') ?? '';
      expect(href).not.toBe('');
      expect(href).not.toBe('#');
      expect(href).not.toMatch(GENERIC_SELF_ROUTE);
    }

    for (const control of [
      ...within(pulse).queryAllByRole('button'),
      ...within(pulse).queryAllByRole('link'),
    ]) {
      fireEvent.click(control);
    }

    for (const [destination] of onNavigate.mock.calls) {
      expect(typeof destination).toBe('string');
      expect(destination).not.toBe('');
      expect(destination).not.toMatch(GENERIC_SELF_ROUTE);
    }
  });
});
