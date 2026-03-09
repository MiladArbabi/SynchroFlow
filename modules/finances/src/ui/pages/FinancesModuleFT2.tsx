// modules/finances/src/ui/pages/FinancesModuleFT2.tsx

import React, { ReactNode } from 'react';
import {
  FT2Layout,
  FT2Row,
} from '@lasyncro/ui-ft2';

/**
 * FinancesModuleFT2DataProps
 * -------------------------
 * DATA-ONLY FT2 contract.
 *
 * - Observability only
 * - No inference
 * - Uncertainty expressed via null
 */
export interface FinancesModuleFT2DataProps {
  context: {
    revenueObserved: number | null;
    netObserved: number | null;
  };

  timeAwareness:
    | {
        history: 'sufficient' | 'insufficient';
      }
    | null;

  timeline:
    | {
        bucket: 'day';
        points: Array<{
          from: string;
          to: string;
          revenueObserved: number | null;
        }>;
      }
    | null;

  blindSpots:
    | {
        costs: 'unknown' | 'known';
        refunds: 'unknown' | 'known';
        history: 'insufficient' | 'sufficient';
      }
    | null;

  decisionSafety:
    | {
        status: 'safe' | 'unsafe' | 'unknown';
      }
    | null;

  profitPreconditions:
    | {
        status: 'ready' | 'not_ready';
      }
    | null;

  refundReality:
    | {
        status: 'known' | 'unknown';
      }
    | null;

  costReality:
    | {
        status: 'known' | 'partial' | 'unknown';
      }
    | null;

  refundImpact:
    | {
        status: 'material' | 'immaterial' | 'unknown';
      }
    | null;

  financialConsistency:
    | {
        status: 'stable' | 'volatile' | 'unknown';
      }
    | null;
}

/**
 * FinancesModuleFT2Props
 * ---------------------
 * FULL render contract.
 *
 * - Extends data props
 * - Visuals injected
 */
export type FinancesModuleFT2Props =
  FinancesModuleFT2DataProps;

export default function FinancesModuleFT2(
  props: FinancesModuleFT2Props
) {
  const {
    context,
    timeAwareness,
    timeline,
    blindSpots,
    decisionSafety,
    profitPreconditions,
    refundReality,
    costReality,
    refundImpact,
    financialConsistency,
  } = props;

  return (
    <FT2Layout>

      {/* ───────── Core Financial Reality ───────── */}
      <FT2Row intent="kpi">
          {context.revenueObserved ?? '—'}
      </FT2Row>

    </FT2Layout>
  );
}
