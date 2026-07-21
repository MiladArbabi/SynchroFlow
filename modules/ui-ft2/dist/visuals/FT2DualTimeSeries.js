import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { FT2EmptyState } from './FT2EmptyState.js';
export function FT2DualTimeSeries({ left, right, }) {
    if (left === null && right === null) {
        return _jsx(FT2EmptyState, {});
    }
    const leftSeries = left ?? [];
    const rightSeries = right ?? [];
    // Build a shared, ordered date index (no inference)
    const dates = Array.from(new Set([
        ...leftSeries.map(p => p.date),
        ...rightSeries.map(p => p.date),
    ])).sort();
    return (_jsx("div", { "data-ft2-dual-timeseries": true, "data-testid": "ft2-dual-timeseries-frame", children: dates.map((date) => {
            const leftPoint = leftSeries.find(p => p.date === date);
            const rightPoint = rightSeries.find(p => p.date === date);
            return (_jsxs("div", { "data-testid": "ft2-dual-timeseries-row", "data-ft2-dual-timeseries-row": true, children: [_jsx("span", { "data-ft2-dual-timeseries-date": true, children: date }), leftPoint?.value !== null && leftPoint?.value !== undefined && (_jsx("span", { "data-testid": "ft2-dual-timeseries-left-value", "data-ft2-dual-timeseries-left-value": true, children: leftPoint.value })), rightPoint?.value !== null && rightPoint?.value !== undefined && (_jsx("span", { "data-testid": "ft2-dual-timeseries-right-value", "data-ft2-dual-timeseries-right-value": true, children: rightPoint.value }))] }, date));
        }) }));
}
//# sourceMappingURL=FT2DualTimeSeries.js.map