// modules/overview/src/ui/pages/OverviewModuleFT2.tsx
import {
  FT2Row,
  InfoBlock,
  InfoBlockRow,
} from '@lasyncro/ui-ft2';

/**
 * OverviewModuleFT2DataProps
 * -------------------------
 * DATA-ONLY FT2 contract.
 * No fetching. No mapping. No hooks.
 */
/**
 * ROOverviewModuleFT2DataProps
 * ---------------------------
 * FT2 Reality Overview — DATA contract.
 *
 * Purpose:
 * - Cross-domain apex snapshot
 * - Presence + structural coherence only
 *
 * HARD RULES:
 * - No lifecycle semantics
 * - No inference
 * - No trends, no deltas
 * - Null = epistemic absence
 */

export interface OverviewModuleFT2DataProps {
  /**
   * Trust / Data Health (Apex)
   * -------------------------
   * Observational trust surface.
   * No scoring, no advice.
   */
  trust: {
    dataFreshness: 'fresh' | 'stale' | 'unknown' | null;
    syncCoverage: 'complete' | 'partial' | 'missing' | 'unknown' | null;
    crossSourceConsistency: 'consistent' | 'inconsistent' | 'unknown' | null;
    trustEligible: boolean | null;
  } | null;

  /**
   * Domain Presence Snapshot
   * ------------------------
   * Presence-only, no interpretation.
   */
  context: {
    ordersObserved: number | null;
    productsObserved: number | null;
    customersObserved: number | null;
  };

  /**
   * Domain Reality Facts
   * --------------------
   * Thin factual rollups.
   * MUST mirror domain FT2 snapshots.
   */
  snapshot: {
    orders: {
      revenueTotal: number | null;
      currency: string | null;
    } | null;

    products: null;

    customers: null;
  };

  /**
   * Cross-Domain Alignment (Structural)
   * ----------------------------------
   * No “good/bad”, only coherence.
   */
  alignment: {
    demandReality?: 'aligned' | 'divergent' | 'unknown';
    operationalEconomic?: 'aligned' | 'divergent' | 'unknown';
    engagementRevenue?: 'aligned' | 'divergent' | 'unknown';
  } | null;
}

export type OverviewModuleFT2Props = OverviewModuleFT2DataProps;

export default function OverviewModuleFT2(props: OverviewModuleFT2Props) {
  
  const {
  trust,
  context = {
    ordersObserved: null,
    productsObserved: null,
    customersObserved: null,
  },
} = props;

/**
 * UI-only trust affordance
 * -----------------------
 * Derived locally from Trust FT2.
 * No mutation of data contracts.
 */
const trustTone =
  trust == null
    ? undefined
    : trust.trustEligible === true
      ? 'trusted'
      : trust.trustEligible === false
        ? 'blocked'
        : 'constrained';

  return (
    <>
      <InfoBlock title="Orders observed">
        <InfoBlockRow label='' value={context.ordersObserved}/>
      </InfoBlock>

      <InfoBlock title="Products observed">
        <InfoBlockRow label='' value={context.productsObserved}/>
      </InfoBlock>

      <InfoBlock title="Customers observed">
        <InfoBlockRow label='' value={context.customersObserved}/>
      </InfoBlock>
    </>
  );
}
