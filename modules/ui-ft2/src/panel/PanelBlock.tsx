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
import type { SxProps, Theme } from '@mui/material/styles';

export type PanelBlockProps = {
  children: ReactNode;

  /**
   * Optional style overrides.
   *
   * Allows signal surfaces and other panel consumers
   * to add contextual styling (severity stripes, emphasis)
   * without modifying PanelBlock internals.
   */
  sx?: SxProps<Theme>;
};

export function PanelBlock({ children, sx }: PanelBlockProps) {
  return (
    <Box
      data-ft2-panel-block
      sx={{
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
      }}
    >
      {children}
    </Box>
  );
}