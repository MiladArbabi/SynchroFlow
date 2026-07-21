import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { FT2Panel, PanelRow, PanelFooter } from '@lasyncro/ui-ft2';
export function OrdersDecisionBrief({ span = 1, ready_to_ship, inventory_blocked_revenue, awaiting_customer, manual_review, }) {
    return (
    /**
       * Panel Title
       * -----------
       * Execution Pipeline represents the operational execution layer
       * for order fulfillment workflows surfaced in the Control Tower.
       *
       * Naming must remain stable because panel titles are used by
       * operators and screenshots in operational runbooks.
       */
    _jsxs(FT2Panel, { title: "Execution Pipeline", span: span, children: [_jsx(PanelRow, { label: "Ready to Ship", value: ready_to_ship }), _jsx(PanelRow, { label: "Blocked by Inventory", value: inventory_blocked_revenue }), _jsx(PanelRow, { label: "Awaiting Customer ", value: awaiting_customer }), _jsx(PanelRow, { label: "Manual Review ", value: manual_review }), _jsx(PanelFooter, { line1: "> BACKEND-DERIVED RISK SNAPSHOT", line2: "> ORDERING AUTHORITATIVE" })] }));
}
//# sourceMappingURL=OrdersDecisionBrief.js.map