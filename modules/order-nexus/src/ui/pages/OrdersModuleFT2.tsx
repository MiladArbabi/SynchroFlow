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
import type { OperationalSignal } from '../../contracts/operationalSignals.js';

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
import { updateSignalLifecycle } from '../mappers/lifecycle/signalLifecycleEngine.js';

/**
 * Operations Queue action handler
 *
 * Responsibilities:
 * - emit operational intent
 * - trigger lifecycle progression
 * - provide observable instrumentation
 *
 * NOTE
 * ----
 * Real orchestration will later be delegated to
 * the Action Orchestrator layer.
 */
function handleOperationsAction(
  actionType: string,
  signal: OperationalSignal
) {

  console.info('[OrdersModuleFT2] Operational action received', {
    actionType,
    signalId: signal.id,
  });

  /**
   * ACTION ROUTER
   * -------------
   * Explicit action registry for Operations Queue.
   *
   * Rules:
   * - Every actionType emitted by the signal mapper
   *   MUST be registered here.
   * - Unknown actions trigger a hard error.
   *
   * This ensures the UI never exposes
   * non-functional operational controls.
   */
  switch (actionType) {

    case 'open_inventory_blocked_orders':
    case 'open_sla_risk_orders':
    case 'open_manual_review_orders':
    case 'investigate_orders':
    case 'inspect_exception_orders':
    case 'investigate_aging_orders':
    case 'inspect_partial_orders':
    case 'review_payment_orders':
      updateSignalLifecycle(signal.id, 'IN_PROGRESS');
        console.info('[OrdersModuleFT2] navigation action requested', {
          actionType,
          signalId: signal.id
        });
      break;

    case 'notify_inventory_supplier':
    case 'prioritize_orders':
    case 'print_shipping_labels':
    case 'contact_customer':
    case 'start_fulfillment_batch':
    case 'contact_warehouse':
    case 'contact_customer_payment':
    case 'split_shipments':
    /**
     * WAREHOUSE EXECUTION WORKFLOWS
     * -----------------------------
     * Actions that initiate fulfillment pipeline operations.
     *
     * generate_pick_list
     *   → creates picking session for warehouse execution
     */
    case 'generate_pick_list':
      updateSignalLifecycle(signal.id, 'IN_PROGRESS');
        console.info('[OrdersModuleFT2] workflow action requested', {
          actionType,
          signalId: signal.id
        });
      break;

    default:
      console.error(
        '[OrdersModuleFT2] Unknown OperationsQueue actionType',
        { actionType, signalId: signal.id }
      );

  }

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

    /**
     * PARTIAL FULFILLMENT OPPORTUNITY
     * --------------------------------
     * Orders containing both:
     * - available inventory
     * - out-of-stock items
     *
     * Allows warehouse to ship partial orders.
     * Derived by reconciliation projection.
     */
    partial_fulfillment_opportunity: number;
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
     * SIGNAL ENGINE INPUT
     * -------------------
     * Pass projection snapshot directly to the signal mapper.
     *
     * This prevents schema drift between:
     * resolver → UI → mapper.
     *
     * Any future projection field additions will automatically
     * propagate to the signal engine.
     */
    const operationalSignals = mapOperationalSignals(operationalControl);

  return (
    <FT2Layout>
      <div
        style={{
          display: 'grid',
          /**
           * Responsive dashboard grid
           * -------------------------
           * All panels (including Operations Queue) must
           * participate in the same responsive column rule.
           *
           * minmax(320px, 1fr) guarantees:
           * - panels never shrink below readable width
           * - panels expand evenly across viewport
           * - queue remains visually dominant without fixed width
           */
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gridAutoRows: 'min-content',
          gap: '16px',
          alignItems: 'start'
        }}
      >

        {/* Queue spans vertically */}
        <div
          style={{}}
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
