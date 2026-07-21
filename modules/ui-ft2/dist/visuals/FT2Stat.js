import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box } from '@mui/material';
import { FT2EmptyState } from './FT2EmptyState.js';
import { FT2_TOKENS } from '../layout/ft2.tokens.js';
export function FT2Stat({ value, label, unit }) {
    if (value === null) {
        return _jsx(FT2EmptyState, {});
    }
    return (_jsxs(Box, { "data-ft2-stat": true, sx: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            minWidth: 0,
        }, children: [_jsx(Box, { "data-ft2-stat-value": true, sx: {
                    ...FT2_TOKENS.typography.kpiValue,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                }, children: value }), unit && (_jsx(Box, { "data-ft2-stat-unit": true, sx: FT2_TOKENS.typography.kpiUnit, children: unit })), label && (_jsx(Box, { "data-ft2-stat-label": true, sx: {
                    ...FT2_TOKENS.typography.hint,
                    mt: 0.5,
                }, children: label }))] }));
}
//# sourceMappingURL=FT2Stat.js.map