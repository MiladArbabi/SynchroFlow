import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OrdersModuleFT2 } from '@lasyncro/order-nexus';

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

function expandCriticalGroup(name: RegExp) {
  fireEvent.click(screen.getByRole('button', { name }));
}

describe('OrdersModuleFT2 critical-order inspection — ORD-UX-DETAIL-01 RED', () => {
  it.each([
    ['Address issues', /Address issues/i, criticalOrders.customer],
    ['Out of stock', /Out of stock/i, criticalOrders.inventory],
    ['Operational issues', /Operational issues/i, criticalOrders.operational],
    ['SLA breached', /Shipping SLA breached/i, criticalOrders.sla],
  ])(
    'ORD-DETAIL-01/03 exposes a separate inspect affordance for %s orders',
    (_label, groupName, order) => {
      const onOrderClick = jest.fn();
      renderOrders(makeProps({ onOrderClick }));
      expandCriticalGroup(groupName);

      const inspect = screen.getByRole('button', {
        name: `View order #${order.externalOrderId} details`,
      });

      fireEvent.click(inspect);
      expect(onOrderClick).toHaveBeenCalledTimes(1);
      expect(onOrderClick).toHaveBeenCalledWith(order.lasyncro_order_id);
    }
  );

  it('ORD-DETAIL-04/05 keeps SLA prioritization independent from inspection', async () => {
    const onOrderClick = jest.fn();
    const onPriorityFlag = jest.fn().mockResolvedValue(undefined);
    renderOrders(makeProps({ onOrderClick, onPriorityFlag }));
    expandCriticalGroup(/Shipping SLA breached/i);

    fireEvent.click(screen.getByRole('button', { name: 'Prioritize →' }));

    expect(onOrderClick).not.toHaveBeenCalled();
    expect(onPriorityFlag).toHaveBeenCalledWith([criticalOrders.sla.lasyncro_order_id], true);
  });

  it('ORD-DETAIL-07 preserves the existing Watch inspection path', () => {
    const onOrderClick = jest.fn();
    renderOrders(makeProps({ onOrderClick }));

    fireEvent.click(screen.getByRole('button', { name: 'View →' }));

    expect(onOrderClick).toHaveBeenCalledTimes(1);
    expect(onOrderClick).toHaveBeenCalledWith(watchOrder.lasyncro_order_id);
  });
});
