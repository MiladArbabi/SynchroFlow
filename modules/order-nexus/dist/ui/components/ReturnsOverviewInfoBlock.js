import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { PanelRow, PanelFooter } from '@lasyncro/ui-ft2';
export function ReturnsOverviewInfoBlock({ returnedRevenue, returnedUnits, affectedOrders, }) {
    return (_jsxs(_Fragment, { children: [_jsx(PanelRow, { label: "Returned units", value: returnedUnits }), _jsx(PanelRow, { label: "Orders affected", value: affectedOrders }), _jsx(PanelFooter, { line1: "> POST-FULFILLMENT REGRESSION", line2: "> DOES NOT BLOCK EXECUTION" })] }));
}
//# sourceMappingURL=ReturnsOverviewInfoBlock.js.map