import { jsx as _jsx } from "react/jsx-runtime";
/**
 * PanelHeader
 * -----------
 * Dedicated header primitive for FT2 panels.
 *
 * Responsibilities
 * ----------------
 * - Render panel title
 * - Provide consistent header layout
 * - Apply title typography and header surface styling
 *
 * Must only be used inside FT2Panel.
 */
import { Box } from '@mui/material';
import { FT2_TOKENS } from '../layout/ft2.tokens.js';
export function PanelHeader({ title }) {
    return (_jsx(Box, { "data-ft2-panel-header": true, sx: {
            height: FT2_TOKENS.controlZoneHeight,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            px: FT2_TOKENS.surfacePadding.standard / 8,
            backgroundColor: FT2_TOKENS.surfaceTitle.background,
            borderBottom: `1px solid ${FT2_TOKENS.surfaceTitle.divider}`,
            ...FT2_TOKENS.typography.surfaceTitle,
        }, children: title }));
}
//# sourceMappingURL=PanelHeader.js.map