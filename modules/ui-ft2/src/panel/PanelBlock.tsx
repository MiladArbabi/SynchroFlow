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
   * Optional DOM anchor.
   *
   * Allows operational surfaces to attach
   * navigation targets without leaking DOM
   * manipulation logic into the layout system.
   */
  id?: string;

  /**
   * Optional style overrides.
   */
  sx?: SxProps<Theme>;
};

export function PanelBlock({ children, id, sx }: PanelBlockProps) {
  return (
    <Box
      id={id}
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