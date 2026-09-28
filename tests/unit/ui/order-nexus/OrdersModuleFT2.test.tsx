// tests/unit/ui/order-nexus/OrdersModuleFT2.test.tsx

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { OrdersModuleFT2 } from '@lasyncro/order-nexus';

describe('OrdersModuleFT2 (no map surface supplied)', () => {
  // The module uses useNavigate(), so every render needs router context.
  //
  // SCREEN-ARCH: an absent mapContent no longer resurrects the old
  // triage-first dashboard. Every input keeps the same Orders screen identity:
  // primary workspace + Order health rail. What is still worth protecting from
  // the earlier suite is kept: a deterministic render with full props,
  // null-safety, and a live Export callback.

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

  const renderWithoutMap = (
    props: Partial<React.ComponentProps<typeof OrdersModuleFT2>> = {},
  ) =>
    render(
      <MemoryRouter>
        <OrdersModuleFT2 {...fullProps} {...props} />
      </MemoryRouter>
    );

  it('renders deterministically with full observability props', () => {
    renderWithoutMap();

    expect(screen.getByText('Orders')).toBeInTheDocument();
    expect(screen.getByText('Order health')).toBeInTheDocument();
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

  it('keeps the Orders screen identity instead of the old triage-first dashboard', () => {
    renderWithoutMap();

    expect(screen.getByText('Order health')).toBeInTheDocument();
    expect(screen.queryByText("Today's pulse")).toBeNull();
    expect(screen.queryByText('Needs a decision')).toBeNull();
    expect(screen.queryByText('Ranked by commercial consequence')).toBeNull();
    expect(screen.queryByText(/Prioritize/i)).toBeNull();
  });

  it('exposes the Export affordance and fires its callback', () => {
    // Supersedes the obsolete "renders no CTAs" expectation: this surface is
    // deliberately actionable now, so the durable contract is that its action
    // is wired, not that it is absent.
    const onExport = jest.fn();
    renderWithoutMap({ onExport });

    fireEvent.click(screen.getByText(/Export/));
    expect(onExport).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// ORD-UX-01 / SCREEN-ARCH — Live Intelligence map layout
// ===========================================================================
// The module never decides map eligibility; it only leases the primary slot
// (real map, LiveMapTeaser, or no-floor teaching state all arrive the same
// way as mapContent). The secondary rail is Order health — state and
// orientation, not a decision inbox — and the triage detail body and any
// landing-surface priority mutation stay absent (Order Flow owns release).

describe('OrdersModuleFT2 — live intelligence map layout', () => {
  /**
   * Fixture shapes follow the module's real prop contracts:
   * constrainedOrders uses the snake_case order_constraints row shape, and
   * operatorSummary.agingOrders uses the aging population shape.
   *
   * Four distinct issue classes are produced (Address issues, Out of stock,
   * Operational issues, Shipping SLA breached) plus an Aging group, so the
   * 3-group preview limit is genuinely exercised. o-4 (returned_undelivered)
   * is included deliberately to prove it contributes to NO group at all
   * (DR-03B2, #1114 — Returns is the sole owner of that decision now).
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

  it('renders the supplied map workspace beside the Order health rail with the four Orders metrics', () => {
    renderWithMap();

    expect(screen.getByTestId('orders-map-surface')).toBeInTheDocument();
    expect(screen.getByText('Order health')).toBeInTheDocument();
    expect(screen.queryByText("Today's pulse")).toBeNull();
    expect(screen.queryByText('Needs a decision')).toBeNull();
    expect(screen.getByText('Breached')).toBeInTheDocument();
    expect(screen.getByText('Blocked')).toBeInTheDocument();
    expect(screen.getByText('Picking')).toBeInTheDocument();
    expect(screen.getByText('Fulfillable')).toBeInTheDocument();
    expect(screen.queryByText(/^\d+ breached$/)).toBeNull();
    expect(screen.queryByText(/still need priority|Critical queue is under control/)).toBeNull();
    expect(screen.queryByText(/fulfilled to date|collected to date/)).toBeNull();
  });

  it('offers View order flow as contextual navigation to Order Flow', () => {
    render(
      <MemoryRouter initialEntries={['/orders']}>
        <Routes>
          <Route
            path="/orders"
            element={<OrdersModuleFT2 {...baseProps} mapContent={<div data-testid="orders-map-surface" />} />}
          />
          <Route path="/orders/flow" element={<div data-testid="order-flow-route" />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByText('View order flow'));
    expect(screen.getByTestId('order-flow-route')).toBeInTheDocument();
  });

  it('uses the uncapped live SLA aggregate for the Breached pulse count', () => {
    renderWithMap({
      operatorSummary: {
        ...operatorSummary,
        fulfillmentSla: {
          fulfillmentSlaHours: 24,
          breachedCount: 25,
          breachedRevenue: 2500,
          approachingCount: 0,
        },
      },
    });

    // Fixture agingOrders contains only one breached row. The pulse must show
    // the live aggregate (25), proving it is no longer capped by inspection rows.
    expect(screen.getByText('25')).toBeInTheDocument();
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

  it('does not render the triage detail body or any landing-surface priority mutation', () => {
    // onPriorityFlag is supplied so absence is not merely a missing callback.
    const onPriorityFlag = jest.fn().mockResolvedValue(undefined);
    renderWithMap({ onPriorityFlag });

    expect(screen.queryByText('Ranked by commercial consequence')).toBeNull();
    expect(screen.queryByText(/Prioritize/i)).toBeNull();
    expect(onPriorityFlag).not.toHaveBeenCalled();
  });

  it('keeps the modal callback compatible — a single-order group opens that order', () => {
    const onOrderClick = jest.fn();
    renderWithMap({ onOrderClick });

    // "Address issues" holds exactly one order in this fixture.
    fireEvent.click(screen.getByText(/Address issues/));
    expect(onOrderClick).toHaveBeenCalledWith('o-1');
  });

  it('suppressOrderHealth withdraws the Order health rail but leaves the primary map workspace in place', () => {
    const { rerender } = renderWithMap();
    const mapNode = screen.getByTestId('orders-map-surface');
    expect(screen.getByText('Order health')).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <OrdersModuleFT2
          {...baseProps}
          mapContent={<div data-testid="orders-map-surface" />}
          suppressOrderHealth
        />
      </MemoryRouter>
    );

    expect(screen.queryByText('Order health')).toBeNull();
    expect(screen.queryByText('Breached')).toBeNull();
    expect(screen.queryByText(/Address issues/)).toBeNull();
    expect(screen.getByTestId('orders-map-surface')).toBe(mapNode);
  });

  it('keeps the same Orders screen identity when no map surface is supplied', () => {
    render(
      <MemoryRouter>
        <OrdersModuleFT2 {...baseProps} />
      </MemoryRouter>
    );

    expect(screen.queryByTestId('orders-map-surface')).toBeNull();
    expect(screen.getByText('Order health')).toBeInTheDocument();
    expect(screen.queryByText('Needs a decision')).toBeNull();
    expect(screen.queryByText('Ranked by commercial consequence')).toBeNull();
    expect(screen.queryByText("Today's pulse")).toBeNull();
  });
});
