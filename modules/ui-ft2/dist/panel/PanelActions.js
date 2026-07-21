import { jsx as _jsx } from "react/jsx-runtime";
/**
 * PanelActions
 * ------------
 * Dedicated action zone for FT2 panels.
 *
 * Responsibilities
 * ----------------
 * - Render operational controls
 * - Maintain consistent spacing
 * - Prevent action controls from mixing with PanelRow layout
 *
 * Must be placed inside FT2Panel.
 */
import { Box } from '@mui/material';
export function PanelActions({ children }) {
    return (_jsx(Box, { "data-ft2-panel-actions": true, sx: {
            /**
             * Grid layout for proportional action buttons.
             *
             * Buttons occupy 90% of panel width and
             * distribute evenly based on count.
             */
            display: 'grid',
            width: '100%',
            justifyContent: 'center',
            /**
             * Prevent action buttons from shrinking
             * below readable width.
             *
             * When viewport shrinks and the grid
             * cannot maintain this width, the parent
             * panel will stop shrinking.
             */
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            /**
             * Consistent spacing between actions
             */
            gap: 1,
            /**
             * Constrain actions to 90% width of panel
             */
            maxWidth: '95%',
            margin: '0 auto',
            /**
             * Buttons must fill their grid cell
             * while preventing text overflow.
             */
            '& > *': {
                width: '100%',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
            },
            /**
             * Action zone spacing
             * Keeps controls close to the row they belong to.
             */
            mt: 0.5,
        }, children: children }));
}
//# sourceMappingURL=PanelActions.js.map