/**
 * FT2Panel
 * --------
 * Unified panel primitive for FT2 dashboards.
 *
 *
 * Panel owns:
 *
 *  - visual surface
 *  - title header
 *  - padding
 *  - trust boundary
 *  - row container
 *
 * Layout participation:
 *
 * Panels implement the FT2Row span contract.
 *
 *   <FT2Row>
 *     <FT2Panel span={1}/>
 *     <FT2Panel span={2}/>
 *   </FT2Row>
 *
 * This file intentionally does NOT depend on InfoBlock
 * to prevent reintroducing the dual container architecture.
 */

import { Paper, Box } from '@mui/material';
import type { ReactNode } from 'react';
import { FT2_TOKENS } from '../layout/ft2.tokens.js';

export type FT2PanelProps = {
  title?: string;
  children?: ReactNode;

  /**
   * Span participation in FT2Row layout engine.
   */
  span?: number;

  /**
   * Epistemic trust boundary.
   */
  trustTone?: 'trusted' | 'constrained' | 'blocked';
};

export function FT2Panel({
  title,
  children,
  span = 1,
  trustTone,
}: FT2PanelProps) {

  return (
    <Paper
      elevation={0}
      data-ft2-panel
      data-ft2-trust={trustTone ?? 'unknown'}
      sx={{
        width: '100%',
        height: '100%',
        minWidth: 0,

        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',

        backgroundColor: FT2_TOKENS.surface.background,
        boxShadow: FT2_TOKENS.surfaceShadow.default,

        borderLeft:
          trustTone
            ? `3px solid ${FT2_TOKENS.trustTone[trustTone]}`
            : 'none',
      }}
    >

      {/* Panel Header */}
      {title && (
        <Box
          data-ft2-panel-header
          sx={{
            height: FT2_TOKENS.controlZoneHeight,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            px: FT2_TOKENS.surfacePadding.standard / 8,

            backgroundColor: FT2_TOKENS.surfaceTitle.background,
            borderBottom: `1px solid ${FT2_TOKENS.surfaceTitle.divider}`,
            ...FT2_TOKENS.typography.surfaceTitle,
          }}
        >
          {title}
        </Box>
      )}

      {/* Panel Body */}
      <Box
        data-ft2-panel-body
        sx={{
          flex: 1,
          minHeight: 0,
          px: FT2_TOKENS.surfacePadding.standard / 8,
          pb: FT2_TOKENS.surfacePadding.standard / 8,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {children}
      </Box>

    </Paper>
  );
}