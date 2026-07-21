import { jsx as _jsx } from "react/jsx-runtime";
/**
 * HealthScoreDisplay
 * ------------------
 * Deterministic numeric representation.
 * No emotional styling.
 * Numeric only + accessible label.
 */
export const HealthScoreDisplay = ({ score }) => {
    return (_jsx("div", { "aria-label": `Health score ${score} out of 100`, "data-health-score": true, style: {
            fontWeight: 600,
            fontSize: 14,
            minWidth: 40,
            textAlign: 'right',
        }, children: score }));
};
//# sourceMappingURL=HealthScoreDisplay.js.map