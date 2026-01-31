// modules/order-nexus/src/ui/pages/OrdersModuleFT2.tsx

import React, { ReactNode, useState } from 'react';
import {
  FT2Layout,
  FT2Row,
} from '@lasyncro/ui-ft2';

import {
  InfoBlock,
  InfoBlockRow,
  InfoBlockFooter,
} from '@lasyncro/ui-ft2';
import { ObligationOverviewInfoBlock } from '../components/ObligationOverviewInfoBlock';

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
  /**
   * System grounding — order obligations (L1)
   */
  orders: {
    total: number | null;
    fulfilled: number | null;
    unfulfilled: number | null;
    incoming: number | null;
  };

  /**
   * Revenue — FT2 observed-only
   * --------------------------
   * Availability-based only.
   * No execution or payment semantics.
   */
  revenue: {
    totalSales: number | null;
    earned: number | null;
    pending: number | null;
    blocked: number | null;
    executionCoverage: 'sufficient' | 'insufficient';
  };

  /**
     * Obligation Overview (FT2)
     * -------------------------
     * Downgraded, read-only visibility into constrained value.
     */
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
   * FT2-adjacent comparison context (preformatted)
   */
  comparison: {
    orders: {
      total: string | null;
      fulfilled: string | null;
      unfulfilled: string | null;
      incoming: string | null;
    };
  };

  /**
   * Revenue — execution-aware 
   * -----------------------------------
   * Optional.
   * Rendered ONLY when explicitly selected by the user.
   * Visibility gates whether values may be shown.
   */
  executionRevenue?: {
    fulfilled: number;
    unfulfilled: number;
    unknown: number;
    visibility: {
      status: 'sufficient' | 'insufficient';
    };
  };

  /**
   * Revenue continuity (L1½)
   */
  revenueContinuity:
    | { status: 'isolated' | 'continuous' }
    | null;

  /**
   * Trust FT2 (module-level)
   */
  trust: {
    trustEligible: boolean | null;
  } | null;
}

/**
 * Rendering-only props
 */
export interface OrdersModuleFT2Props
  extends OrdersModuleFT2DataProps {
  timeseries: ReactNode;
  distribution: ReactNode;
}

export default function OrdersModuleFT2(
  props: OrdersModuleFT2Props
) {
  const {
    orders,
    comparison,
    revenue,
    revenueContinuity,
    obligations,
  } = props;

  return (
    <FT2Layout>
      <FT2Row intent="kpi">

        {/* ─────────────────────────────────────────
        * ORDERS OVERVIEW
        * ───────────────────────────────────────── */}
        <InfoBlock title="Orders overview">
          <InfoBlockRow
            label="Orders total"
            value={orders.total}
            diff={comparison.orders.total}
          />

          <InfoBlockRow
            label="Fulfilled orders"
            value={orders.fulfilled}
            diff={comparison.orders.fulfilled}
          />

          <InfoBlockRow
            label="Unfulfilled orders"
            value={orders.unfulfilled}
            diff={comparison.orders.unfulfilled}
          />

          <InfoBlockRow
            label="Incoming orders"
            value={orders.incoming}
            diff={comparison.orders.incoming}
          />

          <InfoBlockFooter
            line1="> ORDER OBLIGATIONS SHOWN"
            line2="> VALUE AND EXECUTION DETAILED ELSEWHERE"
          />
        </InfoBlock>

        {/* ─────────────────────────────────────────
        * REVENUE OVERVIEW (FT2 — TERMINAL)
        * ───────────────────────────────────────── */}
        <InfoBlock title="Revenue overview">
          <InfoBlockRow
            label="Total sales"
            value={revenue.totalSales}
          />

          <InfoBlockRow
            label="Earned revenue"
            value={
              revenue.executionCoverage === 'sufficient'
                ? revenue.earned
                : null
            }
          />

          <InfoBlockRow
            label="Pending revenue"
            value={
              revenue.executionCoverage === 'sufficient'
                ? revenue.pending
                : null
            }
          />

          <InfoBlockRow
            label="Blocked revenue"
            value={revenue.blocked}
          />

          <InfoBlockFooter
            line1="> SALES VALUE SHOWN"
            line2="> PAYMENT AND PROFIT NOT EVALUATED"
          />
        </InfoBlock>

        {obligations && (
          <ObligationOverviewInfoBlock
            obligations={obligations}
          />
        )}

      </FT2Row>
    </FT2Layout>
  );
}
