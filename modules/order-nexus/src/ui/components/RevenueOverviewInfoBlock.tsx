import { FT2Panel, PanelRow,PanelFooter } from '@lasyncro/ui-ft2';

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

  /**
   * REVENUE EXPOSURE PANEL
   * ----------------------
   * Displays operational revenue exposure derived from
   * orders_operational_control_snapshot.
   *
   * Metric semantics:
   *
   * total_gmv
   *   *   Total sales across all orders (Gross Merchandise Value).
   *
   * realized_revenue
   *   Revenue from fully fulfilled orders.
   *
   * pending_revenue
   *   Paid orders not yet fulfilled.
   *
   * blocked_revenue
   *   Revenue currently constrained by operational issues
   *   (inventory, customer action, or operational review).
   *
   * No calculations are allowed inside the UI layer.
   */
  return (
    <FT2Panel title="Revenue Exposure">
      <PanelRow
        label="Total sales"
        value={revenue.totalSales}
      />

      <PanelRow
        label="Fulfilled sales"
        value={revenue.earned}
      />

      <PanelRow
        label="Orders to ship"
        value={revenue.pending}
      />

      <PanelRow
        label="Orders with problems"
        value={revenue.blocked}
      />
      <PanelFooter
        line1="> VALUES SHOWN — EPISTEMIC STATE"
        line2="> PAYMENT AND PROFIT NOT EVALUATED"
      />
    </FT2Panel>
  );
}