// modules/order-nexus/src/ui/pages/OrdersModuleFT2.tsx
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
import { 
  FT2Layout, 
  FT2Row, 
  FT2Panel, 
  PanelFooter, 
  PanelRow, 
  PanelActions 
} from '@lasyncro/ui-ft2';
import { Button } from '@mui/material';
import type { FT2TemporalProps } from '@lasyncro/ui-ft2';

import { OrdersOverviewInfoBlock } from '../components/OrdersOverviewInfoBlock.js';
import { RevenueOverviewInfoBlock } from '../components/RevenueOverviewInfoBlock.js';
import { RevenueIntegrityInfoBlock } from '../components/RevenueIntegrityInfoBlock.js';

import { OrdersDecisionBrief } from '../components/OrdersDecisionBrief.js';
import { mapOperationalSignals } from '../mappers/mapOperationalSignals.js';
import type { OperationalSignal } from '../../contracts/operationalSignals.js';
import { mapWorkQueues } from '../mappers/mapWorkQueues.js';

/**
 * OPERATIONS QUEUE
 * ----------------
 * Replaces legacy Priority Stack.
 *
 * Surface now exposes operational signals derived from
 * orders_operational_control_snapshot instead of
 * order_risk_snapshot ranking.
 */
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
export interface OrdersModuleFT2DataProps extends FT2TemporalProps {

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
    /**
     * COMMAND CENTER — PRIMARY METRICS
     * --------------------------------
     * Backend-computed decision drivers.
     * Must remain in sync with snapshot + resolver.
     */
    total_at_risk_revenue: number;
    sla_breach_24h_revenue: number;
    top_blocking_type: string;

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

    /**
     * WORK QUEUE METRICS
     * ------------------
     * Derived from orders_operational_control_snapshot.
     *
     * These values represent operational workload queues
     * produced by the reconciliation projection.
     *
     * IMPORTANT:
     * Each queue must appear exactly once in this interface.
     * Duplicate fields create silent TypeScript structural
     * shadowing and can mask schema drift between backend
     * projections and FT2 UI contracts.
     */
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
      ready_to_ship: number;
      awaiting_customer: number;
      inventory_blocked_revenue: string | number;
      manual_review: string | number;
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
      operationalControl,
      distribution
    } = props;

    /**
     * OPERATIONAL HEALTH CLASSIFIER
     * -----------------------------
     * Computes high-level operational state from snapshot metrics.
     * Provides global operational state only.
     * 
     * Design rule:
     * - System Health must never duplicate incident signals.
     * - Actionable issues belong exclusively to Operations Queue.
     *
     * This logic MUST remain presentation-only.
     * No operational decisions may occur here.
     */
    const exceptionOrders = operationalControl?.exception_orders ?? 0;
    const constrainedOrders = operationalControl?.constrained_orders ?? 0;

    let operationalHealth: 'healthy' | 'warning' | 'critical' = 'healthy';

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

    /**
     * Workload queue mapping
     *
     * Converts projection metrics into
     * operational workload queues.
     *
     * Source:
     * orders_operational_control_snapshot
     */
    const workQueues = mapWorkQueues(operationalControl);

  return (
    <FT2Layout>

      {/* -----------------------------------------------------
        SYSTEM HEALTH ROW
        -----------------------------------------------------
        Full-width escalation banner.
        Span=4 guarantees Control Tower priority visibility.
      ----------------------------------------------------- */}
      {operationalHealth !== 'healthy' && (
        <FT2Row intent="support">

          <FT2Panel
            id="system-health"
            title="System Health"
            span={4}
          >
            <PanelRow
              label={
                operationalHealth === 'critical'
                  ? '🚨 Critical operational state'
                  : '⚠️ Operational pressure detected'
              }
              value={
                operationalHealth === 'critical'
                  ? `${constrainedOrders} constrained orders • operational intervention required`
                  : `${exceptionOrders} operational exceptions detected`
              }
            />

            {operationalHealth === 'critical' && (
              <PanelActions>
                <Button
                  size="small"
                  variant="contained"
                  onClick={() => {
                    console.info('[OrdersModuleFT2] banner action', {
                      intent: 'orders.queue.awaiting_inventory'
                    });

                    const queuePanel = document.getElementById('work-queue');

                    if (queuePanel) {
                      queuePanel.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                      });
                    }

                    const queueRow = document.getElementById('queue-awaiting-inventory');

                    if (queueRow) {
                      queueRow.style.transition = 'background-color 0.4s ease';
                      queueRow.style.backgroundColor = 'rgba(245,158,11,0.18)';

                      setTimeout(() => {
                        queueRow.style.backgroundColor = '';
                      }, 1800);
                    }
                  }}
                >
                  View Inventory-Blocked Orders
                </Button>
              </PanelActions>
            )}

            <PanelFooter
              line1="> SYSTEM STATE SUMMARY"
              line2="> SOURCE: orders_operational_control_snapshot"
            />

          </FT2Panel>

        </FT2Row>
      )}

      {/* -----------------------------------------------------
        CORE OPERATIONS ROW
        -----------------------------------------------------
        Control Tower scanning layout.

        Chart (2) | Operations (1) | WorkQueue (1)

        FT2Row span engine ensures deterministic
        proportional layout regardless of viewport.
      ----------------------------------------------------- */}

      {/* /**
        * ARCHITECTURAL GUARDRAIL — OPERATIONAL COMMAND CENTER
        * ---------------------------------------------------
        * This row is NO LONGER a visualization surface.
        *
        * STRICT RULES:
        * - NO charts
        * - NO timeseries
        * - NO metric exploration UI
        *
        * ONLY:
        * - decision surfaces
        * - prioritized drivers
        * - actionable breakdowns
        *
        * Any violation = architectural regression.
        */ }
      <FT2Row intent="analysis">

      {/** COMMAND CENTER (PLACEHOLDER)
      * -----------------------------
      * Timeseries removed from primary surface.
      * Will be replaced by OperationalCommandCenter.
      *
      * DO NOT reintroduce charts here. */ }
      <FT2Panel span={2} title="Operational Command Center">
        {/* TODO: mount <OperationalCommandCenter /> */}
      </FT2Panel>

      {/* Signals Surface */}
      {/* /**
      * SIGNAL SURFACE REMOVED
      * ----------------------
      * Signals are now part of the Operational Command Center.
      *
      * DO NOT render signals as a separate panel.
      */}
    </FT2Row>

      {/* -----------------------------------------------------
        BUSINESS CONTEXT ROW
        -----------------------------------------------------
        Informational surfaces supporting operator decisions.
        Each panel span=1 to maintain visual parity.
      ----------------------------------------------------- */}
      <FT2Row intent="analysis">

        <OrdersOverviewInfoBlock
          span={1}
          orders={orders}
        />

        <RevenueOverviewInfoBlock
          span={1}
          revenue={{
            totalSales: revenue.totalSales,
            earned: revenue.earned,
            pending: revenue.pending,
          }}
        />

        <OrdersDecisionBrief
          span={1}
          {...decision.brief}
        />

      {/**
        * DEGRADED SNAPSHOT SAFETY
        * ------------------------
        * Resolver may return null when the operational snapshot
        * is unavailable (projection rebuild or pipeline failure).
        *
        * UI must tolerate null and surface degraded system state
        * rather than crashing the Control Tower.
        */}
        <RevenueIntegrityInfoBlock
          at_risk_revenue={operationalControl?.at_risk_revenue ?? null}
          revenue_leakage={operationalControl?.revenue_leakage ?? null}
          avg_contribution_margin_pct={
            operationalControl?.avg_contribution_margin_pct ?? null
          }
        />

      </FT2Row>

      {/* Optional analytical surfaces */}
      {distribution}

    </FT2Layout>
  );
}