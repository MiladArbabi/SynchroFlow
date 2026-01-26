// modules/order-nexus/src/ui/pages/OrdersModuleFT2.tsx
import React, { ReactNode } from 'react';
import {
  FT2Layout,
  FT2Row,
  FT2Surface,
  FT2Stat,
  FT2Text,
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

      {/* ─────────────────────────────────────────
        CORE SURFACE A
        System Grounding & Economic Reality
        ----------------------------------
        Answers:
        - Is this system real?
        - Is data flowing?
        - Is revenue present and continuous?
        This surface is existence-only.
      ───────────────────────────────────────── */}

      <FT2Row intent="kpi">
        {/* Orders Presence */}
        <FT2Surface
          variant="kpi"
          title="Orders"
          trustTone={trustTone}
          span={1}
        >
          <FT2Stat value={context.ordersObserved} />
        </FT2Surface>

        {/* Revenue Presence */}
        <FT2Surface
          variant="kpi"
          title="Revenue"
          trustTone={trustTone}
          span={1}
        >
          <FT2Stat
            value={
              totals.revenueTotal === null
                ? null
                : totals.revenueTotal.toLocaleString()
            }
          />
          <FT2Text>
            {revenueContinuity?.status ?? '—'}
          </FT2Text>
        </FT2Surface>

        {/* Data Health */}
        <FT2Surface
          variant="kpi"
          title="Data health"
          trustTone={trustTone}
          span={1}
        >
          <FT2Stat
            value={
              dataCoverage.completenessPct === null
                ? null
                : `${dataCoverage.completenessPct}%`
            }
          />
          <FT2Text>
            {visibility?.status ?? '—'}
          </FT2Text>
        </FT2Surface>

        {/* System Flow */}
        <FT2Surface
          variant="kpi"
          title="System flow"
          trustTone={trustTone}
          span={1}
        >
          <FT2Text>
            {ingestion?.status ?? '—'}
          </FT2Text>
          <FT2Text>
            {freshness?.status ?? '—'}
          </FT2Text>
        </FT2Surface>
      </FT2Row>

      {/* ─────────────────────────────────────────
        CORE SURFACE B
        Direction & System Coherence
        ----------------------------
        Requires grounding above to be meaningful.
        Classification only. No causation.
      ───────────────────────────────────────── */}

      <FT2Row intent="support">
        {/* Outcome & Direction */}
        <FT2Surface
          title="Outcome & direction"
          trustTone={trustTone}
          span={1}
        >
          <FT2Text>
            {outcome?.status ?? '—'}
          </FT2Text>
          <FT2Text>
            {trend?.direction ?? '—'}
          </FT2Text>
        </FT2Surface>

        {/* Market Coherence */}
        <FT2Surface
          title="Market coherence"
          trustTone={trustTone}
          span={1}
        >
          <FT2Text>
            {alignment?.demandReality ?? '—'}
          </FT2Text>
          <FT2Text>
            {alignment?.engagementRevenue ?? '—'}
          </FT2Text>
        </FT2Surface>

        {/* Execution Coherence */}
        <FT2Surface
          title="Execution coherence"
          trustTone={trustTone}
          span={1}
        >
          <FT2Text>
            {alignment?.operationalEconomic ?? '—'}
          </FT2Text>
        </FT2Surface>
      </FT2Row>

      {/* ─────────────────────────────────────────
        OPTIONAL SURFACE C
        Activity Shape (Exploratory)
        ---------------------------
        Observational only.
        Must never dominate the module.
      ───────────────────────────────────────── */}

      <FT2Row intent="analysis">
        <FT2Surface
          title="Orders over time"
          trustTone={trustTone}
          span={2}
        >
          {timeseries}
        </FT2Surface>

        <FT2Surface
          title="Order sizes"
          trustTone={trustTone}
          span={2}
        >
          {distribution}
        </FT2Surface>
      </FT2Row>
    </FT2Layout>
  );
}
