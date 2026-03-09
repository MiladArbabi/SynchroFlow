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
        display: 'flex',
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 1,

        '& > *': {
          flex: '0 0 auto',
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