import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { FT2Panel, PanelRow, PanelFooter } from '@lasyncro/ui-ft2';
export function OrdersOverviewInfoBlock({ span = 1, orders, }) {
    /**
     * PANEL CONTENT ONLY
     * ------------------
     * Container ownership moved to FT2Panel.
     * This component now renders rows only.
     */
    return (_jsxs(FT2Panel, { title: "Operational Metrics", span: span, children: [_jsx(PanelRow, { label: "Total orders", value: orders.total }), _jsx(PanelRow, { label: "Fulfilled", value: orders.fulfilled }), _jsx(PanelRow, { label: "Unfulfilled", value: orders.unfulfilled }), _jsx(PanelRow, { label: "Constrained orders", value: orders.constrained }), _jsx(PanelFooter, { line1: "> LIFETIME OPERATIONAL STATE", line2: "> NON-TEMPORAL, EXECUTION-BASED" })] }));
}
//# sourceMappingURL=OrdersOverviewInfoBlock.js.map