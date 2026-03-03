// modules/order-nexus/src/ui/components/RevenueIntegrityInfoBlock.tsx
//
// Phase 1 — Revenue Integrity InfoBlock
// --------------------------------------
// Renders deterministic revenue control metrics.
// Pure display. No derivation.

import React from 'react';
import {
  InfoBlock,
  InfoBlockRow,
} from '@lasyncro/ui-ft2';

export interface RevenueIntegrityInfoBlockProps {
  realized_revenue: number;
  at_risk_revenue: number;
  blocked_revenue: number;
  revenue_leakage: number;
  avg_contribution_margin_pct: number;
}

export function RevenueIntegrityInfoBlock(
  props: RevenueIntegrityInfoBlockProps
) {
  const {
    realized_revenue,
    at_risk_revenue,
    blocked_revenue,
    revenue_leakage,
    avg_contribution_margin_pct,
  } = props;

  return (
    <InfoBlock title="Revenue Integrity">
      <InfoBlockRow
        label="Realized Revenue"
        value={realized_revenue}
      />
      <InfoBlockRow
        label="At-Risk Revenue"
        value={at_risk_revenue}
      />
      <InfoBlockRow
        label="Blocked Revenue"
        value={blocked_revenue}
      />
      <InfoBlockRow
        label="Revenue Leakage"
        value={revenue_leakage}
      />
      <InfoBlockRow
        label="Avg Contribution Margin %"
        value={avg_contribution_margin_pct}
      />
    </InfoBlock>
  );
}