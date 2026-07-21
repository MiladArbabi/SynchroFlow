import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { PanelRow, PanelFooter, } from '@lasyncro/ui-ft2';
export function ProductsOperationalInfoBlock({ inventory, fulfillment, stability, }) {
    return (_jsxs(_Fragment, { children: [_jsx(PanelRow, { label: "Inventory visibility", value: inventory }), _jsx(PanelRow, { label: "Fulfillment visibility", value: fulfillment }), _jsx(PanelRow, { label: "Operational stability", value: stability }), _jsx(PanelFooter, { line1: "> OPERATIONAL SIGNALS SHOWN", line2: "> EXECUTION DETAILS SHOWN ELSEWHERE" })] }));
}
//# sourceMappingURL=ProductsOperationalInfoBlock.js.map