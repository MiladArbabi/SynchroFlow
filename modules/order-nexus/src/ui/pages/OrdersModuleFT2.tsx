// modules/order-nexus/src/ui/pages/OrdersModuleFT2.tsx
import { FT2Layout, FT2Row, FT2Panel } from '@lasyncro/ui-ft2';

/**
 * FT2 LAYOUT CONTRACT
 * -------------------
 * Every FT2Row child must implement the span contract.
 *
 * Current implementation:
 *   FT2Panel
 *
 * Historical note:
 *   FT2Surface was previously used but has been
 *   superseded by the unified FT2Panel primitive.
 */

import { OrdersOverviewInfoBlock } from '../components/OrdersOverviewInfoBlock.js';
import { RevenueOverviewInfoBlock } from '../components/RevenueOverviewInfoBlock.js';
import { RevenueIntegrityInfoBlock } from '../components/RevenueIntegrityInfoBlock.js';
import { OrderHealthInfoBlock } from '../components/OrderHealthInfoBlock.js';

import { OrdersDecisionBrief } from '../components/OrdersDecisionBrief.js';
import { mapOperationalSignals } from '../mappers/mapOperationalSignals.js';

/**
 * OPERATIONS QUEUE
 * ----------------
 * Replaces legacy Priority Stack.
 *
 * Surface now exposes operational signals derived from
 * orders_operational_control_snapshot instead of
 * order_risk_snapshot ranking.
 */
import { OperationsQueueSection } from '../components/OperationsQueueSection.js';

/**
 * Operational action dispatcher
 * -----------------------------
 * Central orchestration point for Operations Queue actions.
 *
 * Design rules:
 * - UI emits intent
 * - Module layer decides execution
 * - Enables analytics and audit instrumentation
 */
function handleOperationsAction(actionType: string, signal: any) {
  console.info('[OrdersModuleFT2] Operational action received', {
    actionType,
    signalId: signal?.id,
  });

  /**
   * Placeholder orchestration layer.
   *
   * Future integration points:
   * - router navigation
   * - order execution APIs
   * - batch workflows
   */
}

/**
 * ─────────────────────────────────────────────────────────────
 * ORDERS MODULE — FT2
 * ─────────────────────────────────────────────────────────────
 *
 * Purpose:
 * - Render the canonical, read-only FT2 truth surface for Orders.
 *
 * Core invariants:
 * - No inference
 * - No recommendations
 * - No execution assumptions
 * - Equal visual weight for all values
 * - `null` ALWAYS renders as epistemic absence (`—`)
 */

/**
 * OrdersModuleFT2DataProps
 * -----------------------
 * STRICT data contract.
 * This component performs NO data derivation.
 */
export interface OrdersModuleFT2DataProps {

  orders: {
    total: number | null;
    fulfilled: number | null;
    unfulfilled: number | null;
    constrained: number | null;
  };

  revenue: {
    totalSales: number | null;
    earned: number | null;
    pending: number | null;
    blocked: number | null;
  };

    /**
   * Phase 1 — Operational Control Snapshot
   * --------------------------------------
   * Fully derived backend snapshot.
   * Strict passthrough only.
   *
   * NOTE:
   * This module is environment-agnostic.
   * No logging or runtime branching allowed here.
   */
  operationalControl: {
    snapshot_date: string;
    aggregate_version: number;

    realized_revenue: number;
    at_risk_revenue: number;
    blocked_revenue: number;
    revenue_leakage: number;
    avg_contribution_margin_pct: number;

    orders_at_sla_risk: number;
    aging_24h: number;
    aging_48h: number;
    aging_72h_plus: number;
    pending_fulfillment: number;
    pending_payment: number;
    exception_orders: number;

    constrained_orders: number;
    revenue_blocked_inventory: number;
    revenue_blocked_customer: number;
    revenue_blocked_operational: number;

    queue_manual_review: number;
    queue_awaiting_inventory: number;
    queue_ready_to_ship: number;
    queue_awaiting_customer: number;
  };

  returns?: {
    returnedRevenue: number | null;
    returnedUnits: number | null;
    affectedOrders: number | null;
  };

  obligations?: {
    totalBlockedValue: number | null;
    blockedBy: {
      inventory: number | null;
      customer: number | null;
      operational: number | null;
      other: number | null;
    } | null;
    coverage: {
      status: 'sufficient' | 'insufficient';
    };
  };

  /**
   * Decision Layer (Authoritative Backend Snapshot)
   * -----------------------------------------------
   * Fully derived. No client computation.
   * Backend owns ordering and scoring.
   */
  decision: {
    brief: {
      critical_orders_count: number;
      negative_margin_orders_count: number;
      sla_breached_count: number;
      inventory_blocked_revenue: string | number;
      refund_exposure: string | number;
    };
  };
};


export default function OrdersModuleFT2(
  props: OrdersModuleFT2DataProps
) {
    const {
      orders,
      revenue,
      returns,
      obligations,
      decision,
      operationalControl
    } = props;

    /**
     * Operational signals
     * -------------------
     * Derived from operational control snapshot.
     * This decouples UI components from raw snapshot fields.
     */
    const operationalSignals = mapOperationalSignals({
      queue_manual_review: operationalControl.queue_manual_review,
      queue_awaiting_inventory: operationalControl.queue_awaiting_inventory,
      queue_ready_to_ship: operationalControl.queue_ready_to_ship,
      queue_awaiting_customer: operationalControl.queue_awaiting_customer,
      orders_at_sla_risk: operationalControl.orders_at_sla_risk,
      pending_fulfillment: operationalControl.pending_fulfillment,
    });

  return (
    <FT2Layout>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '360px repeat(auto-fit, minmax(320px, 1fr))',
          gridAutoRows: 'min-content',
          gap: '16px',
          alignItems: 'start'
        }}
      >

        {/* Queue spans vertically */}
        <div
          style={{
            gridRow: 'span 2'
          }}
        >
          <OperationsQueueSection
            signals={operationalSignals}
            onAction={handleOperationsAction}
          />
        </div>

        <OrdersOverviewInfoBlock orders={orders} />

        <RevenueOverviewInfoBlock
          revenue={{
            totalSales: revenue.totalSales,
            earned: revenue.earned,
            pending: revenue.pending,
            blocked: revenue.blocked
          }}
        />

        <OrdersDecisionBrief {...decision.brief} />

        <RevenueIntegrityInfoBlock
          realized_revenue={operationalControl.realized_revenue}
          at_risk_revenue={operationalControl.at_risk_revenue}
          blocked_revenue={operationalControl.blocked_revenue}
          revenue_leakage={operationalControl.revenue_leakage}
          avg_contribution_margin_pct={
            operationalControl.avg_contribution_margin_pct
          }
        />

      </div>
    </FT2Layout>
  );
}
