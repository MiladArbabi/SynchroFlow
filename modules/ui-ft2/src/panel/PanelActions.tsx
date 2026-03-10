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
import type { ReactNode } from 'react';

export type PanelActionsProps = {
  children: ReactNode;
};

export function PanelActions({ children }: PanelActionsProps) {
  return (
    <Box
      data-ft2-panel-actions
      sx={{
        /**
         * Grid layout for proportional action buttons.
         *
         * Buttons occupy 90% of panel width and
         * distribute evenly based on count.
         */
        display: 'grid',
        width: '100%',
        justifyContent: 'center',

        gridTemplateColumns: 'repeat(auto-fit, minmax(0, 1fr))',

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
         * Buttons expand to fill their grid cell.
         */
        '& > *': {
          width: '100%',
        },

        /**
         * Action zone spacing
         * Keeps controls close to the row they belong to.
         */
        mt: 0.5,
      }}
    >
      {children}
    </Box>
  );
}