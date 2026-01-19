// modules/finances/src/ui/pages/FinancesModuleFT2.tsx

import React, { ReactNode } from 'react';
import {
  FT2Layout,
  FT2Row,
  FT2Surface,
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
  } = props;

  return (
    <FT2Layout>

      {/* ───────── Core Financial Reality ───────── */}
      <FT2Row intent="kpi">
        <FT2Surface variant="kpi" title="Revenue observed">
          {context.revenueObserved ?? '—'}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Net observed">
          {context.netObserved ?? '—'}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Financial readiness">
          {timeAwareness === null
            ? '—'
            : timeAwareness.history === 'sufficient'
              ? 'Ready'
              : 'Partial'}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Decision safety">
          {decisionSafety?.status ?? '—'}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Profit validity">
          {profitPreconditions?.status ?? '—'}
        </FT2Surface>

      </FT2Row>

      {/* ───────── Activity Over Time ───────── */}
      <FT2Row intent="analysis">
        <FT2Surface title="Revenue activity (observed)">
          {timeline === null || timeline.points.length === 0
            ? '—'
            : 'Data available'}
        </FT2Surface>
      </FT2Row>

      {/* ───────── Blind Spots ───────── */}
      <FT2Row intent="support">
        <FT2Surface title="Blind spots">
          {blindSpots === null
            ? '—'
            : [
                blindSpots.costs === 'unknown' && 'Costs',
                blindSpots.refunds === 'unknown' && 'Refunds',
                blindSpots.history === 'insufficient' && 'History',
              ]
                .filter(Boolean)
                .join(', ') || 'None'}
        </FT2Surface>
      </FT2Row>

    </FT2Layout>
  );
}
