import { jsx as _jsx } from "react/jsx-runtime";
import { Box } from '@mui/material';
import { FT2_TOKENS } from '../layout/ft2.tokens.js';
/**
 * FT2AxisLabel
 * ------------
 * Structural annotation only.
 * Never semantic. Never emphasized.
 */
export function FT2AxisLabel({ label }) {
    if (!label)
        return null;
    return (_jsx(Box, { "data-ft2-axis-label": true, sx: {
            ...FT2_TOKENS.typography.hint,
            textAlign: 'center',
            userSelect: 'none',
            whiteSpace: 'nowrap',
        }, children: label }));
}
//# sourceMappingURL=FT2AxisLabel.js.map