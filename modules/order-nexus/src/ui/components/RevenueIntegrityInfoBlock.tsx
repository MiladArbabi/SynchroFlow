// modules/order-nexus/src/ui/components/RevenueIntegrityInfoBlock.tsx
//
// Phase 1 — Revenue Integrity InfoBlock
// --------------------------------------
// Renders deterministic revenue control metrics.
// Pure display. No derivation.
import { FT2Panel, PanelRow,PanelFooter } from '@lasyncro/ui-ft2';

export interface RevenueIntegrityInfoBlockProps {
  /**
   * FT2Row layout participation.
   * Allows this panel to participate in
   * the Control Tower span layout engine.
   */
  span?: number;
  at_risk_revenue: number;
  revenue_leakage: number;
  avg_contribution_margin_pct: number;
}

export function RevenueIntegrityInfoBlock({
  span = 1,
  at_risk_revenue,
  revenue_leakage,
  avg_contribution_margin_pct,
}: RevenueIntegrityInfoBlockProps) {

  return (
    <FT2Panel
        title="Financial Integrity"
        span={span}
      >
      <PanelRow
        label="At-Risk Revenue"
        value={at_risk_revenue}
      />
      <PanelRow
        label="Revenue Leakage"
        value={revenue_leakage}
      />
      <PanelRow
        label="Avg Contribution Margin %"
        value={avg_contribution_margin_pct}
      />

      <PanelFooter
        line1="> INTEGRITY OF REVENUE"
        line2="> IS MY MONEY SAFE?"
      />
    </FT2Panel>
  );
}