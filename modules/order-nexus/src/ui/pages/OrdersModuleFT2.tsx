// modules/order-nexus/src/ui/pages/OrdersModuleFT2.tsx

import React, { ReactNode, useState } from 'react';
import {
  FT2Layout,
  FT2Row,
} from '@lasyncro/ui-ft2';

import { OrdersOverviewInfoBlock } from '../components/OrdersOverviewInfoBlock';
import { RevenueOverviewInfoBlock } from '../components/RevenueOverviewInfoBlock';
import { ReturnsOverviewInfoBlock } from '../components/ReturnsOverviewInfoBlock';
import { ObligationOverviewInfoBlock } from '../components/ObligationOverviewInfoBlock';

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
  /**
   * System grounding — order obligations (L1)
   */

  /**
   * FT2-adjacent comparison context (preformatted)
   */
  comparison: {
    orders: {
      fulfilled: string | null;
      incoming: string | null;
    };
  };

  orders: {
    active: number | null;
    fulfilled: number | null;
    added: number | null;
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
   * Returns — post-execution regression
   * -----------------------------------
   * Financial only.
   * Does NOT affect eligibility or execution.
   */
  returns?: {
    returnedRevenue: number | null;
    returnedUnits: number | null;
    affectedOrders: number | null;
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
      returns,
      revenueContinuity,
      obligations,
    } = props;


  const fmtMoney = (v: number | null) =>
    v == null ? null : Number(v.toFixed(2));

  return (
    <FT2Layout>
      <FT2Row intent="kpi">

        <OrdersOverviewInfoBlock
          orders={orders}
          incomingDiff={comparison.orders.incoming}
        />

       <RevenueOverviewInfoBlock
          revenue={{
            totalSales: toEpistemic(revenue.totalSales),
            earned: toEpistemic(revenue.earned),
            pending: toEpistemic(revenue.pending),
            blocked: toEpistemic(revenue.blocked),
            executionCoverage: revenue.executionCoverage,
          }}
        />

        <ReturnsOverviewInfoBlock
          returnedRevenue={returns?.returnedRevenue ?? null}
          returnedUnits={returns?.returnedUnits ?? null}
          affectedOrders={returns?.affectedOrders ?? null}
        />
        </FT2Row>

        <FT2Row intent='kpi'>
        <ObligationOverviewInfoBlock
          obligations={
            obligations ?? {
              totalBlockedValue: null,
              blockedBy: {
                inventory: null,
                customer: null,
                operational: null,
                other: null,
              },
              coverage: {
                status: 'insufficient',
              },
            }
          }
        />

      </FT2Row>
    </FT2Layout>
  );
}
