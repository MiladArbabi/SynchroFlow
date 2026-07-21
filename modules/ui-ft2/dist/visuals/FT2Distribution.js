import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { FT2EmptyState } from './FT2EmptyState.js';
export function FT2Distribution({ buckets }) {
    if (buckets === null) {
        return _jsx(FT2EmptyState, {});
    }
    return (_jsx("div", { "data-ft2-distribution": true, "data-testid": "ft2-distribution-frame", children: buckets.map((bucket) => (_jsxs("div", { "data-ft2-distribution-bucket": true, children: [_jsx("div", { "data-testid": "ft2-distribution-bucket-label", "data-ft2-distribution-bucket-label": true, children: bucket.key }), bucket.value !== null && (_jsx("div", { "data-testid": "ft2-distribution-bucket-value", "data-ft2-distribution-bucket-value": true, children: bucket.value }))] }, bucket.key))) }));
}
//# sourceMappingURL=FT2Distribution.js.map