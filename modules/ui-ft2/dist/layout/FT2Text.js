import { jsx as _jsx } from "react/jsx-runtime";
import { Box } from '@mui/material';
import { FT2_TOKENS } from './ft2.tokens.js';
/**
 * FT2Text
 * -------
 * Non-KPI prose inside FT2 surfaces.
 *
 * Rules:
 * - Observational only
 * - No emphasis, no decoration
 * - Must not compete with KPI values
 * - Typography is locked to FT2 tokens
 */
export function FT2Text({ children, align = 'left', }) {
    return (_jsx(Box, { "data-ft2-text": true, sx: {
            ...FT2_TOKENS.typography.body,
            textAlign: align,
            whiteSpace: 'normal',
            wordBreak: 'break-word',
        }, children: children }));
}
//# sourceMappingURL=FT2Text.js.map