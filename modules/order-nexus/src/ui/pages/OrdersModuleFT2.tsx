// modules/order-nexus/src/ui/pages/OrdersModuleFT2.tsx

import React, { ReactNode, useState } from 'react';
import {
  FT2Layout,
  FT2Row,
} from '@lasyncro/ui-ft2';

import { OrdersOverviewInfoBlock } from '../components/OrdersOverviewInfoBlock.js';
import { RevenueOverviewInfoBlock } from '../components/RevenueOverviewInfoBlock.js';
import { RevenueIntegrityInfoBlock } from '../components/RevenueIntegrityInfoBlock.js';
import { OrderHealthInfoBlock } from '../components/OrderHealthInfoBlock.js';

import { OrdersDecisionBrief } from '../components/OrdersDecisionBrief.js';
import { OrdersPriorityStackSection } from '../components/OrdersPriorityStackSection.js';

import { toEpistemic } from '@lasyncro/epistemic';

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
    priorityStack: {
      order_id: string;
      order_health_score: number;
    }[];
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

  return (
    <FT2Layout>
      <FT2Row intent="kpi">

      /**
        * PRIORITY STACK
        * --------------
        * The backend API already returns deterministically ranked orders.
        * UI must never truncate or reorder the stack to prevent priority drift.
        */
        <OrdersPriorityStackSection items={decision.priorityStack} />

        <OrdersOverviewInfoBlock
          orders={orders}
        />

        <RevenueOverviewInfoBlock
          revenue={{
            totalSales: toEpistemic(revenue.totalSales),
            earned: toEpistemic(revenue.earned),
            pending: toEpistemic(revenue.pending),
            blocked: toEpistemic(revenue.blocked),
          }}
        />
      </FT2Row>

      <FT2Row intent='kpi'>
        <OrdersDecisionBrief {...decision.brief} />

        <RevenueIntegrityInfoBlock
          realized_revenue={operationalControl.realized_revenue}
          at_risk_revenue={operationalControl.at_risk_revenue}
          blocked_revenue={operationalControl.blocked_revenue}
          revenue_leakage={operationalControl.revenue_leakage}
          avg_contribution_margin_pct={operationalControl.avg_contribution_margin_pct}
        />

        <OrderHealthInfoBlock
          orders_at_sla_risk={operationalControl.orders_at_sla_risk}
          aging_24h={operationalControl.aging_24h}
          aging_48h={operationalControl.aging_48h}
          aging_72h_plus={operationalControl.aging_72h_plus}
          pending_fulfillment={operationalControl.pending_fulfillment}
          pending_payment={operationalControl.pending_payment}
          exception_orders={operationalControl.exception_orders}
        />
      </FT2Row>
    </FT2Layout>
  );
}
