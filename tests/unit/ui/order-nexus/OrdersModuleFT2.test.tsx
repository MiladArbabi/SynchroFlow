// tests/unit/ui/order-nexus/OrdersModuleFT2.test.tsx

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OrdersModuleFT2 } from '@lasyncro/order-nexus';

describe('OrdersModuleFT2 (triage-first fallback)', () => {
  // The module uses useNavigate(), so every render needs router context.
  //
  // These cases previously asserted a long-removed component generation: a bare
  // observability dump with a `orders-ft2-root` testid and "Period" /
  // "Orders observed" / "Total revenue" rows, under an "observability only"
  // doctrine that also forbade CTAs and action language. None of that survives
  // in the current triage-first module — `orders-ft2-root` does not exist in
  // the source at all, and the surface is deliberately full of CTAs now.
  //
  // What is still worth protecting is kept: a deterministic render with full
  // props, null-safety, the fallback structure, and a live callback.

  const fullProps = {
    context: {
      period: { from: '2025-01-01', to: '2025-01-31' },
      ordersObserved: 120,
    },
    totals: {
      revenueTotal: 18500,
      costTotal: 14300,
      currency: 'USD',
    },
    outcome: { status: 'negative' },
    trend: { direction: 'down' },
    dataCoverage: { completenessPct: 82 },
  } as unknown as React.ComponentProps<typeof OrdersModuleFT2>;

  const renderFallback = (
    props: Partial<React.ComponentProps<typeof OrdersModuleFT2>> = {},
  ) =>
    render(
      <MemoryRouter>
        <OrdersModuleFT2 {...fullProps} {...props} />
      </MemoryRouter>
    );

  it('renders deterministically with full observability props', () => {
    renderFallback();

    expect(screen.getByText('Orders')).toBeInTheDocument();
    expect(screen.getByText("Today's pulse")).toBeInTheDocument();
  });

  it('renders safely when nullable blocks are null', () => {
    const { container } = render(
      <MemoryRouter>
        <OrdersModuleFT2
          {...({
            context: { period: { from: '2025-01-01', to: '2025-01-31' }, ordersObserved: null },
            totals: { revenueTotal: null, costTotal: null, currency: null },
            outcome: null,
            trend: null,
            dataCoverage: { completenessPct: null },
          } as unknown as React.ComponentProps<typeof OrdersModuleFT2>)}
        />
      </MemoryRouter>
    );

    // Unknown values must surface as an em dash rather than crashing or
    // rendering a misleading zero — the original null-safety intent, kept.
    expect(screen.getByText('Orders')).toBeInTheDocument();
    expect(container.textContent).toContain('—');
  });

  it('renders the triage-first fallback when no map surface is supplied', () => {
    renderFallback();

    // mapContent is optional: without it the module stays on the triage layout.
    expect(screen.getByText('Needs a decision')).toBeInTheDocument();
    expect(screen.getByText('Ranked by commercial consequence')).toBeInTheDocument();
  });

  it('structural contract: header, decision card and pulse all render together', () => {
    // Replaces the old whole-tree snapshot. That snapshot froze a component
    // generation that no longer exists, so it protected nothing about today's
    // module; these are the same structural landmarks expressed semantically,
    // and they survive incidental markup changes.
    renderFallback();

    expect(screen.getByText('Orders')).toBeInTheDocument();
    expect(screen.getByText('Needs a decision')).toBeInTheDocument();
    expect(screen.getByText("Today's pulse")).toBeInTheDocument();
  });

  it('exposes the Export affordance and fires its callback', () => {
    // Supersedes the obsolete "renders no CTAs" expectation: this surface is
    // deliberately actionable now, so the durable contract is that its action
    // is wired, not that it is absent.
    const onExport = jest.fn();
    renderFallback({ onExport });

    fireEvent.click(screen.getByText(/Export/));
    expect(onExport).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// ORD-UX-01 — Live Intelligence map layout
// ===========================================================================
// The module never decides map eligibility; it only leases the left slot.
// With mapContent supplied it must render the map + compact 280px decision
// rail, and must NOT render the triage detail body.

describe('OrdersModuleFT2 — live intelligence map layout', () => {
  /**
   * Fixture shapes follow the module's real prop contracts:
   * constrainedOrders uses the snake_case order_constraints row shape, and
   * operatorSummary.agingOrders uses the aging population shape.
   *
   * Five distinct issue classes are produced (Address issues, Out of stock,
   * Operational issues, Package returned, Shipping SLA breached) plus an
   * Aging group, so the 3-group preview limit is genuinely exercised.
   */
  const constrainedOrders = [
    { order_id: 'o-1', external_order_id: '#1001', constraint_type: 'customer', block_type: 'address_invalid', revenue: 400, age_since_creation_seconds: 180000, is_shipping_sla_breached: false },
    { order_id: 'o-2', external_order_id: '#1002', constraint_type: 'inventory', block_type: 'out_of_stock', revenue: 300, age_since_creation_seconds: 216000, is_shipping_sla_breached: false },
    { order_id: 'o-3', external_order_id: '#1003', constraint_type: 'operational', block_type: 'pick_exception', revenue: 200, age_since_creation_seconds: 252000, is_shipping_sla_breached: false },
    { order_id: 'o-4', external_order_id: '#1004', constraint_type: 'operational', block_type: 'returned_undelivered', revenue: 100, age_since_creation_seconds: 288000, is_shipping_sla_breached: false },
  ];

  const agingOrder = (
    id: string,
    externalOrderId: string,
    ageHours: number,
    revenue: number,
    isShippingSlaBreached: boolean,
  ) => ({
    lasyncro_order_id: id,
    externalOrderId,
    ageHours,
    isShippingSlaBreached,
    constraintType: null,
    blockType: null,
    isPriorityFlagged: false,
    inPickBatch: false,
    pickBatchStatus: null,
    revenue,
    timeToSlaBreachMinutes: null,
  });

  const operatorSummary = {
    constraintCounts: { inventory: 1, customer: 1, operational: 2 },
    agingOrders: [
      // Breached, unconstrained → "Shipping SLA breached"
      agingOrder('o-5', '#1005', 96, 900, true),
      // Aging, not breached → Watch → "Aging — review soon"
      agingOrder('o-6', '#1006', 40, 50, false),
    ],
  };

  const baseProps = {
    context: { period: { from: '2026-08-01', to: '2026-08-31' }, ordersObserved: 120 },
    totals: { revenueTotal: 18500, costTotal: 14300, currency: 'USD' },
    outcome: null,
    trend: null,
    dataCoverage: { completenessPct: 90 },
    orders: { fulfilled: 12 },
    operatorSummary,
    constrainedOrders,
  } as unknown as React.ComponentProps<typeof OrdersModuleFT2>;

  function renderWithMap(extra: Record<string, unknown> = {}) {
    return render(
      <MemoryRouter>
        <OrdersModuleFT2
          {...baseProps}
          mapContent={<div data-testid="orders-map-surface" />}
          {...extra}
        />
      </MemoryRouter>
    );
  }

  it('renders the supplied map, decision rail and four pulse metrics without redundant pulse content', () => {
    renderWithMap();

    expect(screen.getByTestId('orders-map-surface')).toBeInTheDocument();
    expect(screen.getByText('Needs a decision')).toBeInTheDocument();
    expect(screen.getByText("Today's pulse")).toBeInTheDocument();
    expect(screen.getByText('Breached')).toBeInTheDocument();
    expect(screen.getByText('Blocked')).toBeInTheDocument();
    expect(screen.getByText('Picking')).toBeInTheDocument();
    expect(screen.getByText('Fulfillable')).toBeInTheDocument();
    expect(screen.queryByText(/^\d+ breached$/)).toBeNull();
    expect(screen.queryByText(/still need priority|Critical queue is under control/)).toBeNull();
    expect(screen.queryByText(/fulfilled to date|collected to date/)).toBeNull();
    expect(screen.queryByText('View order flow')).toBeNull();
  });

  it('shows group summaries only — never individual order rows', () => {
    renderWithMap();

    // Order numbers identify individual orders; the rail must not list them.
    for (const n of ['#1001', '#1002', '#1003', '#1004', '#1005', '#1006']) {
      expect(screen.queryByText(new RegExp(n))).toBeNull();
    }
  });

  it('previews at most three groups and defers the rest', () => {
    renderWithMap();

    expect(screen.getByText(/See \d+ more/)).toBeInTheDocument();
  });

  it('does not render the triage detail body or its inline bulk-priority UI', () => {
    renderWithMap();

    expect(screen.queryByText('Ranked by commercial consequence')).toBeNull();
    expect(screen.queryByText(/Prioritize all/)).toBeNull();
  });

  it('keeps the modal callback compatible — a single-order group opens that order', () => {
    const onOrderClick = jest.fn();
    renderWithMap({ onOrderClick });

    // "Address issues" holds exactly one order in this fixture.
    fireEvent.click(screen.getByText(/Address issues/));
    expect(onOrderClick).toHaveBeenCalledWith('o-1');
  });

  it('falls back to the triage layout when no map surface is supplied', () => {
    render(
      <MemoryRouter>
        <OrdersModuleFT2 {...baseProps} />
      </MemoryRouter>
    );

    expect(screen.queryByTestId('orders-map-surface')).toBeNull();
    expect(screen.getByText('Ranked by commercial consequence')).toBeInTheDocument();
    expect(screen.getByText("Today's pulse")).toBeInTheDocument();
  });
});
