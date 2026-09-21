// DR-03B2 (#1114): the "Package returned" Critical Decisions tile was
// removed entirely — returned_undelivered is Returns-owned post-shipment
// recovery, never an Orders Overview decision, and is NOT folded into any
// other tile ("Operational issues", "Shipping SLA breached") either. This
// file previously asserted the tile's existence; it now asserts its
// permanent absence under every admission path that used to produce it.
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

describe('OrdersModuleFT2 returned-undelivered semantics (DR-03B2, #1114)', () => {
  it('never renders a "Package returned" tile, and does not fold the order into Operational issues either', () => {
    renderModule(makeProps());

    expect(screen.queryByRole('button', { name: /Package returned/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Package returned/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Pick exception/i)).not.toBeInTheDocument();
    // The aging-only returned_undelivered order must not surface under any
    // other Critical Decisions tile either — it has no home here anymore.
    expect(screen.queryByRole('button', { name: /Operational issues/i })).not.toBeInTheDocument();
  });

  it('A — a constrained-only returned package (no SLA-breach prerequisite) never appears in Critical Decisions', () => {
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

    expect(screen.queryByText('#900099')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Package returned/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Operational issues/i })).not.toBeInTheDocument();
  });

  it('B — an SLA-breached order that is also returned_undelivered never appears in Critical Decisions (not Package returned, not Shipping SLA breached)', () => {
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
    expect(screen.queryByRole('button', { name: /Package returned/i })).not.toBeInTheDocument();
    expect(screen.queryByText('#900099')).not.toBeInTheDocument();
  });

  it('C — an ordinary SLA-breached order without returned_undelivered stays under Shipping SLA breached, unaffected', () => {
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
