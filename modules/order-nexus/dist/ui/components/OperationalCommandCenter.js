import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useTheme } from '@mui/material/styles';
import { formatCurrencyCompact } from '@lasyncro/shared/ui';
export const OperationalCommandCenter = ({ operationalControl, onDriverClick, onBreakdownClick, onUrgencyClick, currency, }) => {
    const theme = useTheme();
    const fmt$ = (n) => formatCurrencyCompact(n, currency?.displayCurrency, currency?.locale, currency?.rates);
    /**
     * PRIMARY METRICS
     * ----------------
     * These define operator focus.
     */
    const totalAtRisk = operationalControl.total_at_risk_revenue;
    const urgency = operationalControl.sla_breach_24h_revenue;
    /**
     * URGENCY CLASSIFICATION
     * ----------------------
     * Forces visibility of time-critical risk.
     */
    const isCritical = urgency > 0;
    const topDriver = operationalControl.top_blocking_type;
    const breakdown = [
        {
            label: 'Inventory',
            value: operationalControl.revenue_blocked_inventory,
        },
        {
            label: 'Customer',
            value: operationalControl.revenue_blocked_customer,
        },
        {
            label: 'Operational',
            value: operationalControl.revenue_blocked_operational,
        },
    ]
        .sort((a, b) => b.value - a.value);
    /**
     * PRIMARY ISSUE DERIVATION
     * ------------------------
     * Always take highest impact blocker.
     */
    const primaryIssue = breakdown[0];
    /**
     * DRIVER → ACTION MAPPING
     * -----------------------
     * Converts system state into explicit operator action.
     */
    const driverActionMap = {
        inventory: 'Resolve inventory shortages',
        customer: 'Contact customers',
        operational: 'Fix operational blockers',
        none: 'No active blockers',
    };
    const driverActionLabel = driverActionMap[topDriver] ?? 'Investigate issue';
    const handleDriverClick = () => {
        onDriverClick?.(topDriver);
    };
    const handleUrgencyClick = () => {
        if (isCritical) {
            onUrgencyClick?.();
        }
    };
    return (_jsxs("div", { style: { padding: 16 }, children: [_jsxs("div", { onClick: handleDriverClick, style: { cursor: 'pointer', marginBottom: 12 }, children: [_jsxs("strong", { children: ["Fix ", primaryIssue.label, " blockage \u2014 ", fmt$(primaryIssue.value)] }), _jsx("div", { style: { fontSize: 12, opacity: 0.7 }, children: driverActionLabel })] }), isCritical && (_jsxs("div", { onClick: handleUrgencyClick, style: {
                    marginTop: 12,
                    padding: 8,
                    background: 'var(--mui-palette-error-light)',
                    border: '1px solid var(--mui-palette-error-main)',
                    cursor: 'pointer',
                }, children: [_jsxs("strong", { children: ["Immediate risk: ", fmt$(urgency), " revenue breaching SLA"] }), _jsx("div", { style: { fontSize: 12 }, children: "Click to prioritize these orders now" })] })), _jsxs("div", { style: { marginTop: 16 }, children: [_jsx("strong", { children: "Breakdown:" }), breakdown
                        .filter(item => item.value > 0)
                        .slice(0, 2)
                        .map((item, index) => (_jsxs("div", { onClick: () => onBreakdownClick?.(item.label), style: { cursor: 'pointer' }, children: [index === 0 ? _jsx("strong", { children: "\u2192 " }) : null, item.label, ": ", item.value] }, item.label)))] })] }));
};
//# sourceMappingURL=OperationalCommandCenter.js.map