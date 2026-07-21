import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box } from '@mui/material';
import { FT2EmptyState } from './FT2EmptyState.js';
import { FT2_TOKENS } from '../layout/ft2.tokens.js';
export function FT2Ratio({ numerator, denominator, label, }) {
    if (numerator === null && denominator === null) {
        return _jsx(FT2EmptyState, {});
    }
    return (_jsxs(Box, { "data-ft2-ratio": true, sx: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            minWidth: 0,
        }, children: [_jsxs(Box, { "data-ft2-ratio-values": true, sx: {
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 0.75,
                }, children: [numerator !== null && (_jsx(Box, { "data-ft2-ratio-numerator": true, sx: {
                            ...FT2_TOKENS.typography.kpiValue,
                            whiteSpace: 'nowrap',
                        }, children: numerator })), denominator !== null && (_jsxs(Box, { "data-ft2-ratio-denominator": true, sx: {
                            ...FT2_TOKENS.typography.kpiUnit,
                            whiteSpace: 'nowrap',
                        }, children: ["/ ", denominator] }))] }), label && (_jsx(Box, { "data-ft2-ratio-label": true, sx: {
                    ...FT2_TOKENS.typography.hint,
                    mt: 0.5,
                }, children: label }))] }));
}
//# sourceMappingURL=FT2Ratio.js.map