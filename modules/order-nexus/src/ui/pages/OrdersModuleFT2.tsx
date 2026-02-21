// modules/order-nexus/src/ui/pages/OrdersModuleFT2.tsx

import React, { ReactNode, useState } from 'react';
import {
  FT2Layout,
  FT2Row,
} from '@lasyncro/ui-ft2';

import { OrdersOverviewInfoBlock } from '../components/OrdersOverviewInfoBlock.js';
import { RevenueOverviewInfoBlock } from '../components/RevenueOverviewInfoBlock.js';
import { ReturnsOverviewInfoBlock } from '../components/ReturnsOverviewInfoBlock.js';
import { ObligationOverviewInfoBlock } from '../components/ObligationOverviewInfoBlock.js';

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
};

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
      revenue,
      returns,
      obligations,
    } = props;

  return (
    <FT2Layout>
      <FT2Row intent="kpi">

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
