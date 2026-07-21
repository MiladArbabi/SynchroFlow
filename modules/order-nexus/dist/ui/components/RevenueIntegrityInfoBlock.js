import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// modules/order-nexus/src/ui/components/RevenueIntegrityInfoBlock.tsx
//
// Phase 1 — Revenue Integrity InfoBlock
// --------------------------------------
// Renders deterministic revenue control metrics.
// Pure display. No derivation.
import { FT2Panel, PanelRow, PanelFooter } from '@lasyncro/ui-ft2';
export function RevenueIntegrityInfoBlock({ span = 1, at_risk_revenue, revenue_leakage, avg_contribution_margin_pct, }) {
    return (_jsxs(FT2Panel, { title: "Financial Integrity", span: span, children: [_jsx(PanelRow, { label: "At-Risk Revenue", value: at_risk_revenue }), _jsx(PanelRow, { label: "Revenue Leakage", value: revenue_leakage }), _jsx(PanelRow, { label: "Avg Contribution Margin %", value: avg_contribution_margin_pct }), _jsx(PanelFooter, { line1: "> INTEGRITY OF REVENUE", line2: "> IS MY MONEY SAFE?" })] }));
}
//# sourceMappingURL=RevenueIntegrityInfoBlock.js.map