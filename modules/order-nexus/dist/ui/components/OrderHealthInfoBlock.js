import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// modules/order-nexus/src/ui/components/OrderHealthInfoBlock.tsx
//
// Phase 1 — Order Health InfoBlock
// ---------------------------------
// Deterministic display of operational health metrics.
// Pure passthrough. No computation.
import { FT2Panel, PanelRow, PanelFooter } from '@lasyncro/ui-ft2';
export function OrderHealthInfoBlock(props) {
    const { orders_at_sla_risk, aging_24h, aging_48h, aging_72h_plus, pending_fulfillment, pending_payment, exception_orders, } = props;
    return (_jsxs(FT2Panel, { title: "Order Health", children: [_jsx(PanelRow, { label: "Orders at SLA Risk", value: orders_at_sla_risk }), _jsx(PanelRow, { label: "Aging 24h", value: aging_24h }), _jsx(PanelRow, { label: "Aging 48h", value: aging_48h }), _jsx(PanelRow, { label: "Aging 72h+", value: aging_72h_plus }), _jsx(PanelRow, { label: "Pending Fulfillment", value: pending_fulfillment }), _jsx(PanelRow, { label: "Pending Payment", value: pending_payment }), _jsx(PanelRow, { label: "Exception Orders", value: exception_orders }), _jsx(PanelFooter, { line1: "> HEALTH OF ORDERS", line2: "> HOW ARE MY ORDERS DOING?" })] }));
}
//# sourceMappingURL=OrderHealthInfoBlock.js.map