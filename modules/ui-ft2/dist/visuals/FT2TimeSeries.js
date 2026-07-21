import { jsx as _jsx } from "react/jsx-runtime";
export function FT2TimeSeries({ points }) {
    if (!points || points.length === 0) {
        return (_jsx("div", { "data-ft2-timeseries": true, "data-testid": "ft2-timeseries-empty" }));
    }
    return (_jsx("div", { "data-ft2-timeseries": true, "data-testid": "ft2-timeseries-frame", children: points.map((point, index) => (_jsx("div", { "data-ft2-timeseries-point": true, children: point.y ?? '—' }, index))) }));
}
//# sourceMappingURL=FT2TimeSeries.js.map