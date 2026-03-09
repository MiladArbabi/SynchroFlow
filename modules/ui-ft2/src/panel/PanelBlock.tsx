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
import type { ReactNode } from 'react';

export type PanelBlockProps = {
  children: ReactNode;
};

export function PanelBlock({ children }: PanelBlockProps) {
  return (
    <Box
      data-ft2-panel-block
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',

        /**
         * Small separation between signal groups
         */
        gap: 0.5,
      }}
    >
      {children}
    </Box>
  );
}