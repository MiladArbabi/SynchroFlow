import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { HealthScoreDisplay } from './HealthScoreDisplay.js';
/**
 * PriorityStackItem
 * -----------------
 * One ranked order.
 * Must not alter backend ordering.
 */
export const PriorityStackItem = ({ index, orderId, score, children }) => {
    return (_jsxs("li", { "aria-posinset": index + 1, "data-priority-item": true, style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-subtle, #E0E0E0)',
        }, children: [_jsxs("div", { children: [_jsx("div", { style: {
                            fontSize: 13,
                            color: 'var(--text-secondary, #666)',
                        }, children: "Order" }), _jsx("div", { style: {
                            fontSize: 14,
                            fontWeight: 500,
                        }, children: orderId }), children] }), _jsx(HealthScoreDisplay, { score: score })] }));
};
//# sourceMappingURL=PriorityStackItem.js.map