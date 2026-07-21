import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { FT2Panel, PanelRow, PanelFooter } from '@lasyncro/ui-ft2';
export function RevenueOverviewInfoBlock({ span = 1, revenue, }) {
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
    return (_jsxs(FT2Panel, { title: "Revenue Exposure", span: span, children: [_jsx(PanelRow, { label: "Total sales", value: revenue.totalSales }), _jsx(PanelRow, { label: "Fulfilled sales", value: revenue.earned }), _jsx(PanelRow, { label: "Orders to ship", value: revenue.pending }), _jsx(PanelFooter, { line1: "> VALUES SHOWN \u2014 EPISTEMIC STATE", line2: "> PAYMENT AND PROFIT NOT EVALUATED" })] }));
}
//# sourceMappingURL=RevenueOverviewInfoBlock.js.map