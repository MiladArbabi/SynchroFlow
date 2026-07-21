import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function OrderNexusAhaPanel({ summary, onIntent, }) {
    if (!summary.hasRisk) {
        return null;
    }
    return (_jsxs("section", { "data-testid": "order-nexus-aha-panel", children: [_jsx("h2", { children: "Order profitability risk detected" }), _jsxs("p", { children: [summary.riskCount, " order", summary.riskCount > 1 ? 's' : '', " may be losing money."] }), _jsx("button", { type: "button", onClick: () => onIntent({ type: 'START_ONBOARDING' }), children: "Fix this" })] }));
}
//# sourceMappingURL=OrderNexusAhaPanel.js.map