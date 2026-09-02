import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OrdersModuleFT2 from '../../../../modules/order-nexus/src/ui/pages/OrdersModuleFT2';

jest.mock('@lasyncro/shared/ui', () => {
  const React = require('react');

  return {
    formatCurrencyCompact: (value: number) => `$${value.toLocaleString()}`,
    PulseCard: ({ title }: any) => React.createElement('section', {}, title),
    ReorderTransitionList: ({ children }: any) => React.createElement(React.Fragment, {}, children),
  };
});

type Props = React.ComponentProps<typeof OrdersModuleFT2>;

function makeProps(overrides: Partial<Props> = {}) {
  const base = {
    context: {},
    timeseries: null,
    distribution: null,
    orders: {
      total: 1,
      fulfilled: 0,
      unfulfilled: 1,
      constrained: 1,
    },
    revenue: {
      totalSales: 1250,
      earned: 0,
      pending: 1250,
      blocked: 1250,
    },
    operationalControl: {
      snapshot_date: new Date().toISOString(),
      aggregate_version: 1,
      realized_revenue: 0,
      at_risk_revenue: 1250,
      total_at_risk_revenue: 1250,
      sla_breach_24h_revenue: 1250,
      top_blocking_type: 'operational',
      blocked_revenue: 1250,
      revenue_leakage: 0,
      avg_contribution_margin_pct: 0,
      orders_at_sla_risk: 0,
      aging_24h: 1,
      aging_48h: 1,
      aging_72h_plus: 1,
      pending_fulfillment: 0,
      pending_payment: 0,
      exception_orders: 1,
      constrained_orders: 1,
      revenue_blocked_inventory: 0,
      revenue_blocked_customer: 0,
      revenue_blocked_operational: 1250,
      queue_manual_review: 1,
      queue_awaiting_inventory: 0,
      queue_ready_to_ship: 0,
      queue_awaiting_customer: 0,
      partial_fulfillment_opportunity: 0,
    },
    decision: { brief: null },
    operatorSummary: {
      constraintCounts: { inventory: 0, customer: 0, operational: 1 },
      topBlockingType: 'operational',
      agingOrders: [
        {
          lasyncro_order_id: 'order-returned',
          externalOrderId: '1001',
          ageHours: 96,
          isShippingSlaBreached: true,
          constraintType: 'operational',
          blockType: 'returned_undelivered',
          isPriorityFlagged: false,
          inPickBatch: false,
          pickBatchStatus: null,
          revenue: 1250,
          timeToSlaBreachMinutes: null,
        },
      ],
      imminentSlaBreachers: [],
      queueCounts: {
        readyToShip: 0,
        awaitingInventory: 0,
        awaitingCustomer: 0,
        manualReview: 1,
      },
    },
  } as Props;

  return { ...base, ...overrides } as Props;
}

const renderModule = (props: Props) =>
  render(
    <MemoryRouter>
      <OrdersModuleFT2 {...props} />
    </MemoryRouter>
  );

describe('OrdersModuleFT2 returned-undelivered semantics', () => {
  it('renders returned-undelivered as Package returned, not Pick exception', () => {
    renderModule(makeProps());

    fireEvent.click(screen.getByRole('button', { name: /Package returned/i }));

    expect(screen.getAllByText(/Package returned/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Pick exception/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Operational issues/i)).not.toBeInTheDocument();
  });

  // RET-RETPKG — the "Package returned" Critical group is driven by active
  // order_constraints truth (constraint_type='operational' /
  // block_type='returned_undelivered'), delivered via the existing
  // constrained-orders payload. It must NOT depend on the SLA/aging
  // population (order_age_snapshot / isShippingSlaBreached).
  it('A — surfaces a constrained-only returned package with no SLA-breach prerequisite', () => {
    renderModule(
      makeProps({
        operatorSummary: {
          constraintCounts: { inventory: 0, customer: 0, operational: 1 },
          topBlockingType: 'operational',
          agingOrders: [],
          imminentSlaBreachers: [],
          queueCounts: { readyToShip: 0, awaitingInventory: 0, awaitingCustomer: 0, manualReview: 1 },
        },
        constrainedOrders: [
          {
            order_id: 'order-ret-only',
            external_order_id: '900099',
            constraint_type: 'operational',
            block_type: 'returned_undelivered',
            revenue: 0,
            age_since_creation_seconds: null,
            is_shipping_sla_breached: null,
          },
        ],
      } as Partial<Props>)
    );

    fireEvent.click(screen.getByRole('button', { name: /Package returned/i }));
    expect(screen.getByText('#900099')).toBeInTheDocument();
  });

  it('B — an SLA-breached order that is also returned_undelivered appears once, only under Package returned', () => {
    renderModule(
      makeProps({
        operatorSummary: {
          constraintCounts: { inventory: 0, customer: 0, operational: 1 },
          topBlockingType: 'operational',
          agingOrders: [
            {
              lasyncro_order_id: 'order-dup',
              externalOrderId: '900099',
              ageHours: 96,
              isShippingSlaBreached: true,
              constraintType: null,
              blockType: null,
              isPriorityFlagged: false,
              inPickBatch: false,
              pickBatchStatus: null,
              revenue: 500,
              timeToSlaBreachMinutes: null,
            },
          ],
          imminentSlaBreachers: [],
          queueCounts: { readyToShip: 0, awaitingInventory: 0, awaitingCustomer: 0, manualReview: 1 },
        },
        constrainedOrders: [
          {
            order_id: 'order-dup',
            external_order_id: '900099',
            constraint_type: 'operational',
            block_type: 'returned_undelivered',
            revenue: 500,
            age_since_creation_seconds: 345600,
            is_shipping_sla_breached: true,
          },
        ],
      } as Partial<Props>)
    );

    expect(screen.queryByRole('button', { name: /Shipping SLA breached/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Shipping SLA breached/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Package returned/i }));
    expect(screen.getAllByText('#900099')).toHaveLength(1);
  });

  it('C — an ordinary SLA-breached order without returned_undelivered stays under Shipping SLA breached', () => {
    renderModule(
      makeProps({
        operatorSummary: {
          constraintCounts: { inventory: 0, customer: 0, operational: 0 },
          topBlockingType: null,
          agingOrders: [
            {
              lasyncro_order_id: 'order-sla',
              externalOrderId: '2002',
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
          queueCounts: { readyToShip: 0, awaitingInventory: 0, awaitingCustomer: 0, manualReview: 0 },
        },
        constrainedOrders: [],
      } as Partial<Props>)
    );

    fireEvent.click(screen.getByRole('button', { name: /Shipping SLA breached/i }));
    expect(screen.getByText('#2002')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Package returned/i })).not.toBeInTheDocument();
  });
});
