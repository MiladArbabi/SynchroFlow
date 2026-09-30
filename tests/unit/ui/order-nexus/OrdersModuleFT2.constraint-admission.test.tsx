import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OrdersModuleFT2 from '../../../../modules/order-nexus/src/ui/pages/OrdersModuleFT2';

/**
 * ORD-OVERVIEW-INVENTORY-01 — CANONICAL CONSTRAINT ADMISSION
 * ----------------------------------------------------------
 * Ratified contract:
 *
 *   A merchant-actionable active canonical constraint enters Orders
 *   constraint state (Order health "Constraints & aging") from
 *   order_constraints truth, independently of shipping-SLA breach, order
 *   age, and the OrdersOperatorFacts WATCH_FLOOR population.
 *
 *   Constraint answers "WHY is fulfillment blocked?".
 *   SLA answers "HOW URGENT is it?" — urgency, never admission.
 *
 * Ownership note: OrdersModuleFT2.returned-undelivered.test.tsx owns the
 * returned_undelivered SUBTYPE contract, and
 * OrdersModuleFT2.critical-order-inspection.test.tsx owns inspection/CTA
 * behaviour. Neither owns the GENERALISED admission rule, so it lives here.
 *
 * FIXTURE DISCIPLINE (deliberate, do not "simplify"):
 * every order in this file sets `isShippingSlaBreached: false` explicitly and
 * supplies `agingOrders: []`. critical-order-inspection.test.tsx's builder
 * defaults that flag to TRUE, which would admit orders through the very
 * SLA population under test and turn these RED cases falsely green.
 *
 * SCREEN-ARCH: the triage bands (Critical / Watch / Needs a decision) and
 * per-order "#…" rows are retired. A group renders as "<count> <label>";
 * which order a single-order group holds is proven through onOrderClick.
 * Absence is asserted by text, since normalized rows are not all buttons.
 */

jest.mock('@lasyncro/shared/ui', () => {
  const React = require('react');

  return {
    formatCurrencyCompact: (value: number) => `$${value.toLocaleString()}`,
    PulseCard: ({ title }: any) => React.createElement('section', {}, title),
    ReorderTransitionList: ({ children }: any) =>
      React.createElement(React.Fragment, {}, children),
    // Composition-only double: primary always, rail unless suppressed.
    OperationalContextShell: ({ primary, rail, suppressRail }: any) =>
      React.createElement(React.Fragment, {}, primary, suppressRail ? null : rail),
  };
});

type Props = React.ComponentProps<typeof OrdersModuleFT2>;

/** A constrained-orders row: canonical truth, never SLA-breached, fresh. */
function constrainedRow(
  orderId: string,
  externalOrderId: string,
  constraintType: string,
  blockType: string | null,
  revenue = 250
) {
  return {
    order_id: orderId,
    external_order_id: externalOrderId,
    constraint_type: constraintType,
    block_type: blockType,
    revenue,
    // Fresh order: well below WATCH_FLOOR (50% of a 24h SLA = 12h), so the
    // backend aging query would legitimately exclude it from agingOrders.
    age_since_creation_seconds: 60,
    is_shipping_sla_breached: false,
  };
}

/** An agingOrders row. isShippingSlaBreached is REQUIRED, never defaulted. */
function agingRow(
  orderId: string,
  externalOrderId: string,
  constraintType: string | null,
  isShippingSlaBreached: boolean,
  revenue = 700
) {
  return {
    lasyncro_order_id: orderId,
    externalOrderId,
    ageHours: isShippingSlaBreached ? 80 : 1,
    isShippingSlaBreached,
    constraintType,
    blockType: null,
    isPriorityFlagged: false,
    inPickBatch: false,
    pickBatchStatus: null,
    revenue,
    timeToSlaBreachMinutes: null,
  };
}

function makeProps(overrides: Partial<Props> = {}) {
  const base = {
    context: {},
    timeseries: null,
    distribution: null,
    orders: { total: 1, fulfilled: 0, unfulfilled: 1, constrained: 1 },
    revenue: { totalSales: 250, earned: 0, pending: 250, blocked: 250 },
    operationalControl: {
      snapshot_date: new Date().toISOString(),
      aggregate_version: 1,
      realized_revenue: 0,
      at_risk_revenue: 250,
      total_at_risk_revenue: 250,
      sla_breach_24h_revenue: 0,
      top_blocking_type: 'inventory',
      blocked_revenue: 250,
      revenue_leakage: 0,
      avg_contribution_margin_pct: 0,
      orders_at_sla_risk: 0,
      aging_24h: 0,
      aging_48h: 0,
      aging_72h_plus: 0,
      pending_fulfillment: 0,
      pending_payment: 0,
      exception_orders: 1,
      constrained_orders: 1,
      revenue_blocked_inventory: 250,
      revenue_blocked_customer: 0,
      revenue_blocked_operational: 0,
      queue_manual_review: 0,
      queue_awaiting_inventory: 1,
      queue_ready_to_ship: 0,
      queue_awaiting_customer: 0,
      partial_fulfillment_opportunity: 0,
    },
    decision: { brief: null },
    operatorSummary: {
      constraintCounts: { inventory: 0, customer: 0, operational: 0 },
      topBlockingType: null,
      // EMPTY BY DEFAULT: proves admission cannot come from the SLA/aging
      // population. Tests that need an aged order opt in explicitly.
      agingOrders: [],
      imminentSlaBreachers: [],
      queueCounts: {
        readyToShip: 0,
        awaitingInventory: 0,
        awaitingCustomer: 0,
        manualReview: 0,
      },
    },
    constrainedOrders: [],
  } as unknown as Props;

  return { ...base, ...overrides } as Props;
}

/** Asserts `rowText` is rendered and that it inspects exactly `orderId`. */
function expectSingleOrderRow(rowText: string, orderId: string, onOrderClick: jest.Mock) {
  expect(screen.getAllByText(rowText)).toHaveLength(1);
  fireEvent.click(screen.getByText(rowText));
  expect(onOrderClick).toHaveBeenCalledTimes(1);
  expect(onOrderClick).toHaveBeenCalledWith(orderId);
}

const renderModule = (props: Props) =>
  render(
    <MemoryRouter>
      <OrdersModuleFT2 {...props} />
    </MemoryRouter>
  );

describe('OrdersModuleFT2 canonical constraint admission — ORD-OVERVIEW-INVENTORY-01', () => {
  it('OV-CONSTRAINT-01 admits a fresh inventory/oversell constraint under "Out of stock" with no SLA breach and no aging row', () => {
    const onOrderClick = jest.fn();
    renderModule(
      makeProps({
        onOrderClick,
        constrainedOrders: [
          constrainedRow('order-inv', '930101', 'inventory', 'oversell'),
        ],
      } as Partial<Props>)
    );

    expectSingleOrderRow('1 Out of stock', 'order-inv', onOrderClick);
  });

  it('OV-CONSTRAINT-02 admits a fresh customer constraint under "Address issues" with no SLA breach and no aging row', () => {
    const onOrderClick = jest.fn();
    renderModule(
      makeProps({
        onOrderClick,
        constrainedOrders: [
          constrainedRow(
            'order-cust',
            '930102',
            'customer',
            'incomplete_address'
          ),
        ],
      } as Partial<Props>)
    );

    expectSingleOrderRow('1 Address issues', 'order-cust', onOrderClick);
  });

  it('OV-CONSTRAINT-03 admits a fresh non-return operational constraint under "Operational issues" with no SLA breach and no aging row', () => {
    const onOrderClick = jest.fn();
    renderModule(
      makeProps({
        onOrderClick,
        constrainedOrders: [
          constrainedRow(
            'order-ops',
            '930103',
            'operational',
            'pick_exception'
          ),
        ],
      } as Partial<Props>)
    );

    expectSingleOrderRow('1 Operational issues', 'order-ops', onOrderClick);
  });

  it('OV-CONSTRAINT-06 shows a constrained AND SLA-breached order exactly once, under its canonical constraint group', () => {
    const onOrderClick = jest.fn();
    renderModule(
      makeProps({
        onOrderClick,
        operatorSummary: {
          constraintCounts: { inventory: 1, customer: 0, operational: 0 },
          topBlockingType: 'inventory',
          agingOrders: [agingRow('order-both', '930104', 'inventory', true)],
          imminentSlaBreachers: [],
          queueCounts: {
            readyToShip: 0,
            awaitingInventory: 1,
            awaitingCustomer: 0,
            manualReview: 0,
          },
        },
        constrainedOrders: [
          {
            ...constrainedRow('order-both', '930104', 'inventory', 'oversell'),
            age_since_creation_seconds: 288000,
            is_shipping_sla_breached: true,
          },
        ],
      } as Partial<Props>)
    );

    // Canonical constraint owns the group; SLA stays urgency metadata only.
    expect(screen.queryByText(/Shipping SLA breached/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^\d+ Aging/)).not.toBeInTheDocument();

    expectSingleOrderRow('1 Out of stock', 'order-both', onOrderClick);
  });

  it('OV-CONSTRAINT-07 does not require an agingOrders entry for a constrained order to reach constraint state', () => {
    const onOrderClick = jest.fn();
    renderModule(
      makeProps({
        onOrderClick,
        operatorSummary: {
          constraintCounts: { inventory: 1, customer: 0, operational: 0 },
          topBlockingType: 'inventory',
          // The WATCH_FLOOR population is EMPTY. It defines aging, not
          // admission — a fresh block must still surface.
          agingOrders: [],
          imminentSlaBreachers: [],
          queueCounts: {
            readyToShip: 0,
            awaitingInventory: 1,
            awaitingCustomer: 0,
            manualReview: 0,
          },
        },
        constrainedOrders: [
          constrainedRow('order-fresh', '930105', 'inventory', 'oversell'),
        ],
      } as Partial<Props>)
    );

    expectSingleOrderRow('1 Out of stock', 'order-fresh', onOrderClick);
  });

  it('OV-CONSTRAINT-08/09 counts unique constrained orders into non-empty issue groups', () => {
    renderModule(
      makeProps({
        constrainedOrders: [
          constrainedRow('order-a', '930106', 'inventory', 'oversell'),
          constrainedRow('order-b', '930107', 'inventory', 'oversell'),
          constrainedRow('order-c', '930108', 'customer', 'incomplete_address'),
        ],
      } as Partial<Props>)
    );

    // 3 unique orders across exactly 2 non-empty groups (inventory, customer).
    expect(screen.getByText('2 Out of stock')).toBeInTheDocument();
    expect(screen.getByText('1 Address issues')).toBeInTheDocument();
    expect(screen.queryByText(/Operational issues/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Shipping SLA breached/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^\d+ Aging/)).not.toBeInTheDocument();
  });

  it('OV-CONSTRAINT-10 hides groups that have no orders', () => {
    renderModule(
      makeProps({
        constrainedOrders: [
          constrainedRow('order-inv-only', '930109', 'inventory', 'oversell'),
        ],
      } as Partial<Props>)
    );

    expect(screen.getByText('1 Out of stock')).toBeInTheDocument();
    expect(screen.queryByText(/Address issues/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Operational issues/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Package returned/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Shipping SLA breached/i)).not.toBeInTheDocument();
  });

  it('OV-CONSTRAINT-11 does not turn a non-ratified constraint block type into a merchant decision', () => {
    /**
     * allocation_pending has NO ratified merchant-actionable semantics
     * (ORD-OVERVIEW-INVENTORY-01 contract item 10 — pending its own
     * lifecycle audit). Admission must be explicit about what is
     * actionable, not "every active constraint row".
     *
     * This guards the fix from over-generalising. It passes today because
     * nothing is admitted; it must STILL pass afterwards.
     */
    renderModule(
      makeProps({
        constrainedOrders: [
          constrainedRow(
            'order-alloc',
            '930110',
            'inventory',
            'allocation_pending'
          ),
        ],
      } as Partial<Props>)
    );

    expect(screen.queryByText('#930110')).not.toBeInTheDocument();
    expect(screen.queryByText(/Out of stock/i)).not.toBeInTheDocument();
  });

  it('OV-CONSTRAINT-12 admits and surfaces a fresh merchant-actionable non-SLA constraint without describing it as SLA-breached', () => {
    /**
     * SLA breach is an urgency attribute, never the definition of a
     * constrained population: an active merchant-actionable canonical
     * constraint is admitted at any SLA state.
     *
     * `constrained_orders: 0` alongside a live constrained row is the real
     * stale/zero-snapshot window in which a snapshot-driven label could
     * mislabel or drop the constraint.
     *
     * Both halves are asserted together on purpose. Asserting only the
     * absence of "SLA-breached" would pass for the wrong reason if nothing
     * were admitted at all. The contract is: the fresh constraint IS
     * surfaced in constraint state, AND it is not described as SLA-breached.
     */
    renderModule(
      makeProps({
        operationalControl: {
          ...(makeProps().operationalControl as Record<string, unknown>),
          constrained_orders: 0,
          blocked_revenue: 0,
          revenue_blocked_inventory: 0,
        },
        constrainedOrders: [
          constrainedRow('order-copy', '930111', 'inventory', 'oversell', 400),
        ],
      } as unknown as Partial<Props>)
    );

    // 1. the fresh constraint reaches constraint state
    expect(screen.getByText('1 Out of stock')).toBeInTheDocument();

    // 2. it is not described as an SLA breach
    expect(screen.queryByText(/SLA-breached/i)).not.toBeInTheDocument();
  });

  it('OV-CONSTRAINT-13 keeps an actionable-constrained order in its constraint group only, never also as aging', () => {
    const onOrderClick = jest.fn();
    /**
     * WATCH = aging / approaching-SLA orders needing attention that are NOT
     * currently blocked by an actionable canonical constraint.
     *
     * The same order is supplied through BOTH populations — constrained
     * truth (inventory/oversell) and agingOrders (not SLA-breached, so it
     * currently qualifies for Watch). Once canonical admission is fixed the
     * constraint owns the order: it must appear once, under Out of stock,
     * and must not also be listed in Watch.
     */
    renderModule(
      makeProps({
        onOrderClick,
        operatorSummary: {
          constraintCounts: { inventory: 1, customer: 0, operational: 0 },
          topBlockingType: 'inventory',
          agingOrders: [agingRow('order-both-bands', '930112', 'inventory', false)],
          imminentSlaBreachers: [],
          queueCounts: {
            readyToShip: 0,
            awaitingInventory: 1,
            awaitingCustomer: 0,
            manualReview: 0,
          },
        },
        constrainedOrders: [
          constrainedRow('order-both-bands', '930112', 'inventory', 'oversell'),
        ],
      } as Partial<Props>)
    );

    // 1. admitted to its constraint group from constrained truth
    expectSingleOrderRow('1 Out of stock', 'order-both-bands', onOrderClick);

    // 2. owned by the constraint, so not duplicated as an aging group
    expect(screen.queryByText(/^\d+ Aging/)).not.toBeInTheDocument();
  });

  it('OV-CONSTRAINT-14 a priority flag never hides an order whose SLA, aging or constraint condition is still active', () => {
    /**
     * SCREEN-ARCH (C1C): priority is Order Flow planning state, not a
     * resolution. Each flagged order below still has its underlying
     * condition, so each stays represented in Order health exactly once.
     */
    const onOrderClick = jest.fn();
    renderModule(
      makeProps({
        onOrderClick,
        operatorSummary: {
          constraintCounts: { inventory: 1, customer: 0, operational: 0 },
          topBlockingType: 'inventory',
          agingOrders: [
            { ...agingRow('order-sla-flagged', '930201', null, true), isPriorityFlagged: true },
            { ...agingRow('order-aging-flagged', '930202', null, false), isPriorityFlagged: true },
            { ...agingRow('order-constraint-flagged', '930203', 'inventory', false), isPriorityFlagged: true },
          ],
          imminentSlaBreachers: [],
          queueCounts: { readyToShip: 0, awaitingInventory: 1, awaitingCustomer: 0, manualReview: 0 },
        },
        constrainedOrders: [
          constrainedRow('order-constraint-flagged', '930203', 'inventory', 'oversell'),
        ],
      } as Partial<Props>)
    );

    const rows: Array<[RegExp, string]> = [
      [/^1 Shipping SLA breached/, 'order-sla-flagged'],
      [/^1 Aging/, 'order-aging-flagged'],
      [/^1 Out of stock/, 'order-constraint-flagged'],
    ];
    for (const [rowText, orderId] of rows) {
      expect(screen.getAllByText(rowText)).toHaveLength(1);
      onOrderClick.mockClear();
      fireEvent.click(screen.getByText(rowText));
      expect(onOrderClick).toHaveBeenCalledTimes(1);
      expect(onOrderClick).toHaveBeenCalledWith(orderId);
    }
  });
  it('OV-CONSTRAINT-15 an unconstrained SLA-breached order stays in Shipping SLA breached while it is in a pick batch', () => {
    /**
     * SCREEN-ARCH (C1D): pick-batch membership is fulfillment progress, not
     * an SLA resolution. The order is still breached, so it stays represented
     * exactly once in Order health and remains inspectable.
     */
    const onOrderClick = jest.fn();
    renderModule(
      makeProps({
        onOrderClick,
        operatorSummary: {
          constraintCounts: { inventory: 0, customer: 0, operational: 0 },
          topBlockingType: null,
          agingOrders: [
            { ...agingRow('order-sla-in-batch', '930301', null, true), inPickBatch: true, pickBatchStatus: 'picking' },
          ],
          imminentSlaBreachers: [],
          queueCounts: { readyToShip: 0, awaitingInventory: 0, awaitingCustomer: 0, manualReview: 0 },
        },
        constrainedOrders: [],
      } as Partial<Props>)
    );

    expectSingleOrderRow('1 Shipping SLA breached', 'order-sla-in-batch', onOrderClick);
    expect(screen.queryByText(/^\d+ Aging/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Out of stock|Address issues|Operational issues/i)).not.toBeInTheDocument();
  });
});
