import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OrdersModuleFT2 from '../../../../modules/order-nexus/src/ui/pages/OrdersModuleFT2';

jest.mock('@lasyncro/shared/ui', () => {
  const React = require('react');

  return {
    formatCurrencyCompact: (value: number) => `$${value.toLocaleString()}`,
    PulseCard: ({ title, rows, footerCta }: any) =>
      React.createElement(
        'section',
        {},
        React.createElement('h2', {}, title),
        rows?.map((row: any) =>
          React.createElement('div', { key: row.label }, `${row.label}: ${row.value}`)
        ),
        footerCta
          ? React.createElement('button', { type: 'button', onClick: footerCta.onClick }, footerCta.label)
          : null
      ),
    ReorderTransitionList: ({ children }: any) => React.createElement(React.Fragment, {}, children),
    // Composition-only double: primary always, rail unless suppressed.
    OperationalContextShell: ({ primary, rail, suppressRail }: any) =>
      React.createElement(React.Fragment, {}, primary, suppressRail ? null : rail),
  };
});

const makeOrder = (
  id: string,
  externalOrderId: string,
  constraintType: string | null,
  overrides: Partial<{
    isShippingSlaBreached: boolean;
    isPriorityFlagged: boolean;
    inPickBatch: boolean;
  }> = {}
) => ({
  lasyncro_order_id: id,
  externalOrderId,
  ageHours: 96,
  isShippingSlaBreached: overrides.isShippingSlaBreached ?? true,
  constraintType,
  isPriorityFlagged: overrides.isPriorityFlagged ?? false,
  inPickBatch: overrides.inPickBatch ?? false,
  pickBatchStatus: null,
  revenue: 1250,
  timeToSlaBreachMinutes: null,
});

const criticalOrders = {
  customer: makeOrder('order-customer', '1001', 'customer'),
  inventory: makeOrder('order-inventory', '1002', 'inventory'),
  operational: makeOrder('order-operational', '1003', 'operational'),
  sla: makeOrder('order-sla', '1004', null),
};

const watchOrder = makeOrder('order-watch', '1005', null, {
  isShippingSlaBreached: false,
});

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    context: {},
    timeseries: null,
    distribution: null,
    orders: {
      total: 5,
      fulfilled: 0,
      unfulfilled: 5,
      constrained: 3,
    },
    revenue: {
      totalSales: 6250,
      earned: 0,
      pending: 6250,
      blocked: 3750,
    },
    operationalControl: {
      snapshot_date: new Date().toISOString(),
      aggregate_version: 1,
      realized_revenue: 0,
      at_risk_revenue: 6250,
      total_at_risk_revenue: 6250,
      sla_breach_24h_revenue: 5000,
      top_blocking_type: 'inventory',
      blocked_revenue: 3750,
      revenue_leakage: 0,
      avg_contribution_margin_pct: 0,
      orders_at_sla_risk: 0,
      aging_24h: 5,
      aging_48h: 5,
      aging_72h_plus: 5,
      pending_fulfillment: 0,
      pending_payment: 0,
      exception_orders: 0,
      constrained_orders: 3,
      revenue_blocked_inventory: 1250,
      revenue_blocked_customer: 1250,
      revenue_blocked_operational: 1250,
      queue_manual_review: 1,
      queue_awaiting_inventory: 1,
      queue_ready_to_ship: 1,
      queue_awaiting_customer: 1,
      partial_fulfillment_opportunity: 0,
    },
    decision: { brief: null },
    operatorSummary: {
      constraintCounts: { inventory: 1, customer: 1, operational: 1 },
      topBlockingType: 'inventory',
      agingOrders: [
        criticalOrders.customer,
        criticalOrders.inventory,
        criticalOrders.operational,
        criticalOrders.sla,
        watchOrder,
      ],
      imminentSlaBreachers: [],
      queueCounts: {
        readyToShip: 1,
        awaitingInventory: 1,
        awaitingCustomer: 1,
        manualReview: 1,
      },
    },
    ...overrides,
  } as React.ComponentProps<typeof OrdersModuleFT2>;
}

function renderOrders(props = makeProps()) {
  return render(
    <MemoryRouter>
      <OrdersModuleFT2 {...props} />
    </MemoryRouter>
  );
}

// SCREEN-ARCH: the triage-era expandable groups, per-order "View order #…
// details" affordances, Watch "View →" and inline Prioritize are retired.
// Orders still owns individual-order inspection: a single-order Order health
// row IS the inspection affordance (onOrderClick). A multi-order group is
// contextual state only. Prioritization belongs to Order Flow.

/** Reveal every Order health group through the local "See N more" control. */
function revealAllGroups() {
  const more = screen.queryByText(/^See \d+ more$/);
  if (more) fireEvent.click(more);
}

describe('OrdersModuleFT2 critical-order inspection — ORD-UX-DETAIL-01', () => {
  it.each([
    ['Address issues', '1 Address issues', criticalOrders.customer],
    ['Out of stock', '1 Out of stock', criticalOrders.inventory],
    ['Operational issues', '1 Operational issues', criticalOrders.operational],
    ['SLA breached', '1 Shipping SLA breached', criticalOrders.sla],
  ])(
    'ORD-DETAIL-01/03 a single-order %s row opens that order through onOrderClick',
    (_label, rowText, order) => {
      const onOrderClick = jest.fn();
      renderOrders(makeProps({ onOrderClick }));
      revealAllGroups();

      const row = screen.getByText(rowText).closest('button');
      expect(row).not.toBeNull();

      fireEvent.click(row!);
      expect(onOrderClick).toHaveBeenCalledTimes(1);
      expect(onOrderClick).toHaveBeenCalledWith(order.lasyncro_order_id);
    }
  );

  it('ORD-DETAIL-02 a multi-order group is contextual state, not a one-order inspection action', () => {
    const onOrderClick = jest.fn();
    const secondCustomer = makeOrder('order-customer-2', '1006', 'customer');
    renderOrders(
      makeProps({
        onOrderClick,
        operatorSummary: {
          ...makeProps().operatorSummary,
          agingOrders: [criticalOrders.customer, secondCustomer],
        },
      })
    );

    const row = screen.getByText('2 Address issues');
    expect(row.closest('button')).toBeNull();

    fireEvent.click(row);
    expect(onOrderClick).not.toHaveBeenCalled();
  });

  it('ORD-DETAIL-04 removes misleading constrained-row action CTAs', () => {
    renderOrders();
    revealAllGroups();

    expect(screen.getByText('1 Address issues')).toBeInTheDocument();
    expect(screen.getByText('1 Out of stock')).toBeInTheDocument();
    expect(screen.getByText('1 Operational issues')).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: 'Fix address →' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resolve stock →' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resolve issue →' })).toBeNull();
    expect(screen.queryByText(/Prioritize/i)).toBeNull();
  });

  it('ORD-DETAIL-04/05 keeps inspection independent from Order Flow prioritization', () => {
    const onOrderClick = jest.fn();
    const onPriorityFlag = jest.fn().mockResolvedValue(undefined);
    renderOrders(makeProps({ onOrderClick, onPriorityFlag }));
    revealAllGroups();

    expect(screen.queryByText(/Prioritize/i)).toBeNull();

    fireEvent.click(screen.getByText('1 Shipping SLA breached'));

    expect(onOrderClick).toHaveBeenCalledWith(criticalOrders.sla.lasyncro_order_id);
    expect(onPriorityFlag).not.toHaveBeenCalled();
  });

  it('ORD-DETAIL-07 preserves inspection of an aging (former Watch) order', () => {
    const onOrderClick = jest.fn();
    renderOrders(makeProps({ onOrderClick }));
    revealAllGroups();

    fireEvent.click(screen.getByText(/^1 Aging/));

    expect(onOrderClick).toHaveBeenCalledTimes(1);
    expect(onOrderClick).toHaveBeenCalledWith(watchOrder.lasyncro_order_id);
  });
});
