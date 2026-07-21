import { jsx as _jsx } from "react/jsx-runtime";
import { PriorityStackItem } from './PriorityStackItem.js';
/**
 * PriorityStack
 * -------------
 * Semantic ordered list.
 * Ordering MUST match backend.
 * No client-side sorting allowed.
 */
export const PriorityStack = ({ items }) => {
    return (_jsx("ol", { "aria-label": "Prioritized orders by health score", style: {
            listStyle: 'none',
            margin: 0,
            padding: 0,
        }, children: items.map((item, index) => (_jsx(PriorityStackItem, { index: index, orderId: item.order_id, score: item.order_health_score }, item.order_id))) }));
};
//# sourceMappingURL=PriorityStack.js.map