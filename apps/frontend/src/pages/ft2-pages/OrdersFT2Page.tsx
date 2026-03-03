// apps/frontend/src/pages/OrdersFT2Page.tsx
//
// OrdersFT2Page
// -------------
// FT2-only Orders observability surface.
//
// HARD CONTRACT:
// - MUST render OrdersModuleFT2 only
// - MUST NOT render FT1 modules
// - MUST NOT infer lifecycle
// - MUST assume FT2 routing is authoritative

// apps/frontend/src/pages/OrdersFT2Page.tsx

import { OrdersModuleFT2 } from '@lasyncro/order-nexus';

import { useOrdersFt2Snapshot } from '../orders/useOrdersFt2Snapshot';

import { mapOrdersFt2Props } from '../orders/useOrdersFt2Adapter';

import { useOrdersOperationalBrief } from '../orders/useOrdersOperationalBrief';
import { useOrdersPriorityStack } from '../orders/useOrdersPriorityStack';
import { useOrdersControlSnapshot } from '../orders/useOrdersControlSnapshot';

const __DEV__ = import.meta.env.DEV;

export default function OrdersFT2Page() {

  const snapshotQuery = useOrdersFt2Snapshot();

    const operationalBriefQuery = useOrdersOperationalBrief();
    const priorityStackQuery = useOrdersPriorityStack();
    const controlSnapshotQuery = useOrdersControlSnapshot();

  if (
    !snapshotQuery.isSuccess ||
    !priorityStackQuery.isSuccess
  ) {
    console.log('[AUDIT][snapshot]', {
      isSuccess: snapshotQuery.isSuccess,
      status: snapshotQuery.status,
      fetchStatus: snapshotQuery.fetchStatus,
      hasData: !!snapshotQuery.data,
    });

    console.log('[AUDIT][operationalBrief]', {
      isSuccess: operationalBriefQuery.isSuccess,
      status: operationalBriefQuery.status,
      fetchStatus: operationalBriefQuery.fetchStatus,
      hasData: !!operationalBriefQuery.data,
    });

    console.log('[AUDIT][priorityStack]', {
      isSuccess: priorityStackQuery.isSuccess,
      status: priorityStackQuery.status,
      fetchStatus: priorityStackQuery.fetchStatus,
      hasData: !!priorityStackQuery.data,
    });

    console.log('[AUDIT][controlSnapshot]', {
      isSuccess: controlSnapshotQuery.isSuccess,
      status: controlSnapshotQuery.status,
      fetchStatus: controlSnapshotQuery.fetchStatus,
      hasData: !!controlSnapshotQuery.data,
    });

    return <div>Loading orders insights…</div>;
  }

  const brief = operationalBriefQuery.data;
  const operationalControl =
  controlSnapshotQuery.data ?? {
    snapshot_date: new Date().toISOString(),
    aggregate_version: 0,

    realized_revenue: 0,
    at_risk_revenue: 0,
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
  };

  const decision = {
    brief: brief
      ? {
          critical_orders_count: brief.critical_orders_count,
          negative_margin_orders_count: brief.negative_margin_orders_count,
          sla_breached_count: brief.sla_breached_count,
          inventory_blocked_revenue: brief.inventory_blocked_revenue,
          refund_exposure: brief.refund_exposure,
        }
      : {
          critical_orders_count: 0,
          negative_margin_orders_count: 0,
          sla_breached_count: 0,
          inventory_blocked_revenue: 0,
          refund_exposure: 0,
        },

    priorityStack:
      priorityStackQuery.data?.map((row) => ({
        order_id: row.order_id,
        order_health_score: row.order_health_score,
      })) ?? [],
  };

  const headerProps = mapOrdersFt2Props(
    snapshotQuery.data,
    decision,
  );

  if (__DEV__) {
    console.debug('[OrdersFT2Page] control snapshot', controlSnapshotQuery.data);
  }

  if (__DEV__) {
    console.debug('[OrdersFT2Page] rendering OrdersModuleFT2', headerProps);
  }

  return (
    <>
      <OrdersModuleFT2
        {...headerProps}
        operationalControl={operationalControl}
      />
    </>
  );
}