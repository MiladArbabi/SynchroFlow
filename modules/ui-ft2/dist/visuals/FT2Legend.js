import { jsx as _jsx } from "react/jsx-runtime";
import { Box } from '@mui/material';
import { FT2_TOKENS } from '../layout/ft2.tokens.js';
/**
 * FT2Legend
 * ---------
 * Categorical context only.
 * Never instructional. Never semantic.
 */
export function FT2Legend({ items }) {
    if (!items || items.length === 0)
        return null;
    return (_jsx(Box, { "data-ft2-legend": true, sx: {
            display: 'flex',
            gap: 1.25,
            flexWrap: 'wrap',
            justifyContent: 'center',
        }, children: items.map((item, idx) => (_jsx(Box, { "data-ft2-legend-item": true, sx: {
                ...FT2_TOKENS.typography.hint,
                whiteSpace: 'nowrap',
                userSelect: 'none',
            }, children: item.label }, idx))) }));
}
//# sourceMappingURL=FT2Legend.js.map