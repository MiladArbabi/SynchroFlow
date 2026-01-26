// modules/order-nexus/src/ui/pages/OrdersModuleFT2.tsx
import React, { ReactNode } from 'react';
import {
  FT2Layout,
  FT2Row,
  FT2Surface,
} from '@lasyncro/ui-ft2';

import {
  InfoBlock,
  InfoBlockRow,
  InfoBlockFooter,
} from '@lasyncro/ui-ft2';

/**
 * UI INVARIANTS (FT2)
 * ------------------
 * - All values render with equal visual weight
 * - No colors, icons, or emphasis convey meaning
 * - `—` represents epistemic absence everywhere
 * - Rows do not collapse when data is missing
 * - This module reveals truth; it does not guide
 */

/**
 * OrdersModuleFT2DataProps
 * -----------------------
 * DATA-ONLY FT2 contract.
 * No semantics. No inference.
 */

export interface OrdersModuleFT2DataProps {
  /**
   * ─────────────────────────────────────────
   * 🧭 SYSTEM GROUNDING (FOUNDATIONAL)
   * Answers: "Is the system anchored in reality?"
   * ─────────────────────────────────────────
   */

  orders: {
    total: number | null;
    fulfilled: number | null;
    unfulfilled: number | null;
    incoming: number | null;
  };

  context: {
    ordersObserved: number | null;
  };

  totals: {
    revenueTotal: number | null;

    /**
     * Orders FT2 has no cost reality.
     * Non-existent fact → must always render as absence.
     */
    costTotal: number | null;
  };

  /**
   * Canonical data completeness (L1).
   * Factual coverage only. No usability implied.
   */
  dataCoverage: {
    completenessPct: number | null;
  };

  /**
   * Epistemic permission gate (downgraded L2).
   * Answers: "Is interpretation allowed?"
   */
  visibility: {
    status: 'sufficient' | 'insufficient';
  } | null;

  /**
   * Canonical ingestion presence (L1).
   * Answers: "Did LaSyncro observe any facts in this period?"
   */
  ingestion: {
    status: 'present' | 'absent';
  } | null;

  /**
   * Temporal freshness (L1).
   * Answers: "Is the observed data recent?"
   */
  freshness: {
    status: 'recent' | 'stale' | 'unknown';
  } | null;

  /**
   * ─────────────────────────────────────────
   * POST-GROUNDING CONTEXT (L1½ / L2)
   * Requires grounding to be meaningful
   * ─────────────────────────────────────────
   */

  outcome: { status: 'positive' | 'negative' } | null;

  trend: { direction: 'up' | 'down' | 'flat' } | null;

  /**
   * Revenue signal continuity (L1½).
   * Classification only. Not a trend.
   */
  revenueContinuity:
    | { status: 'isolated' | 'continuous' }
    | null;

  /**
   * ─────────────────────────────────────────
   * STRUCTURAL COHERENCE (ALIGNMENT)
   * ─────────────────────────────────────────
   */
  alignment: {
    demandReality?: 'aligned' | 'divergent' | 'unknown';
    engagementRevenue?: 'aligned' | 'divergent' | 'unknown';
    operationalEconomic?: 'aligned' | 'divergent' | 'unknown';
  } | null;

  /**
   * Trust FT2 (module-level)
   * -----------------------
   * Passed through from Trust FT2 snapshot.
   * Interpreted locally in UI.
   */
  trust: {
    trustEligible: boolean | null;
  } | null;
};


/**
 * OrdersModuleFT2Props
 * -------------------
 * Rendering contract.
 * Slots only. No logic.
 */
export interface OrdersModuleFT2Props extends OrdersModuleFT2DataProps {
  timeseries: ReactNode;
  distribution: ReactNode;
}

export default function OrdersModuleFT2(props: OrdersModuleFT2Props) {
  const {
    context,
    totals,
    dataCoverage,
    visibility,

    // 🧭 System Grounding
    ingestion,
    freshness,

    // Post-grounding context
    outcome,
    trend,
    revenueContinuity,

    alignment,
    timeseries,
    distribution,

    trust,
    
    orders,
  } = props;

  /**
 * Trust interpretation (FT2 locked rules)
 * --------------------------------------
 * - null            → no bar
 * - true            → trusted
 * - false           → blocked
 * - null eligible   → constrained
 */
const trustTone =
  trust === null
    ? undefined
    : trust.trustEligible === true
      ? 'trusted'
      : trust.trustEligible === false
        ? 'blocked'
        : 'constrained';

  return (
    <FT2Layout>
      <FT2Row intent="kpi">
        <InfoBlock title="Orders overview">
          <InfoBlockRow
            label="Orders total"
            value={orders.total}
          />

          <InfoBlockRow
            label="Fulfilled orders"
            value={orders.fulfilled}
          />

          <InfoBlockRow
            label="Unfulfilled orders"
            value={orders.unfulfilled}
          />

          <InfoBlockRow
            label="Incoming orders"
            value={orders.incoming}
          />

          <InfoBlockFooter
            line1="ORDER OBLIGATIONS ARE VISIBLE"
            line2="EXECUTION STATES SHOWN ELSEWHERE"
          />
        </InfoBlock>
      </FT2Row>

    </FT2Layout>
  );
}
