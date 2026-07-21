import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * ⚠️ FT2 UI COMPONENT
 * ------------------
 * Read-only.
 * Aggregate-only.
 *
 * This component MUST NOT:
 * - render attribution
 * - imply causes
 * - suggest actions
 */
import { PanelRow, PanelFooter, } from '@lasyncro/ui-ft2';
/**
 * Obligation Overview — FT2
 * -------------------------
 * Read-only visibility into constrained value.
 *
 * No actions.
 * No prioritization.
 * No guidance.
 */
export function ObligationOverviewInfoBlock({ obligations, }) {
    return (_jsxs(_Fragment, { children: [_jsx(PanelRow, { label: "Constraint signals", value: obligations.coverage.status === 'sufficient'
                    ? 'Present'
                    : 'Insufficient data' }), _jsx(PanelFooter, { line1: "> ORDERS MAY BE CONSTRAINED BY EXPLICIT CONDITIONS", line2: "> INVENTORY, CUSTOMER, OR OPERATIONAL" })] }));
}
//# sourceMappingURL=ObligationOverviewInfoBlock.js.map