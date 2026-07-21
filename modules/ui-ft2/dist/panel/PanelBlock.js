import { jsx as _jsx } from "react/jsx-runtime";
/**
 * PanelBlock
 * ----------
 * Structural grouping primitive for FT2Panel.
 *
 * Responsibilities
 * ----------------
 * - Group rows, actions, and secondary rows
 * - Provide consistent vertical spacing
 * - Prevent layout leakage from raw HTML containers
 *
 * Must only be used inside FT2Panel.
 */
import { Box } from '@mui/material';
export function PanelBlock({ children, id, sx }) {
    return (_jsx(Box, { id: id, "data-ft2-panel-block": true, sx: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'stretch',
            /**
             * Row spacing inside a signal block
             */
            gap: 0.5,
            /**
             * Vertical separation between signals
             */
            marginBottom: '20px',
            paddingBottom: '10px',
            /**
             * Divider between signal clusters
             */
            borderBottom: '2px solid var(--ft2-surface-divider)',
            /**
             * Consumer overrides
             */
            ...sx,
        }, children: children }));
}
//# sourceMappingURL=PanelBlock.js.map