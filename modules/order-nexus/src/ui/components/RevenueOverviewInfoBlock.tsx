import {
  PanelRow,
  PanelFooter,
} from '@lasyncro/ui-ft2';

/**
 * RevenueOverviewInfoBlockProps
 * -----------------------------
 * Phase B2:
 * - executionCoverage REMOVED
 * - Epistemic state is the single authority
 * - Component performs NO conditional logic
 */
type RevenueOverviewInfoBlockProps = {
  revenue: {
    totalSales: number | null;
    earned: number | null;
    blocked: number | null;
    pending: number | null;
  };
};

export function RevenueOverviewInfoBlock({
  revenue,
}: RevenueOverviewInfoBlockProps) {

  return (
    <>
      <PanelRow
        label="Total sales"
        value={revenue.totalSales}
      />

      <PanelRow
        label="Earned revenue"
        value={revenue.earned}
      />

      <PanelRow
        label="Pending revenue"
        value={revenue.pending}
      />

      <PanelRow
        label="Blocked revenue"
        value={revenue.blocked}
      />
      <PanelFooter
        line1="> VALUES SHOWN — EPISTEMIC STATE"
        line2="> PAYMENT AND PROFIT NOT EVALUATED"
      />
    </>
  );
}