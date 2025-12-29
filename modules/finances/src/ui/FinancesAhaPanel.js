import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function FinancesAhaPanel({ summary, onIntent, }) {
    if (!summary.hasRisk) {
        return null;
    }
    return (_jsxs("section", { "data-testid": "finances-aha-panel", children: [_jsx("h2", { children: "Financial risk detected" }), _jsxs("p", { children: [summary.riskCount, " financial data point", summary.riskCount > 1 ? 's' : '', " are potentially at risk."] }), _jsx("button", { type: "button", onClick: () => onIntent({ type: 'START_ONBOARDING' }), children: "Fix this" })] }));
}
//# sourceMappingURL=FinancesAhaPanel.js.map