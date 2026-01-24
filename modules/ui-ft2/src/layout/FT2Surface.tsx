import {
  Box,
  Paper,
  IconButton,
} from '@mui/material';
import { FT2_TOKENS } from './tokens';

export type FT2SurfaceVariant = 'standard' | 'kpi';

export type FT2SurfaceProps = {
  children?: React.ReactNode;
  title?: string;
  variant?: FT2SurfaceVariant;

  /**
   * Epistemic trust boundary for FT2 surfaces.
   * Undefined = not evaluated → no visual affordance.
   */
  trustTone?: 'trusted' | 'constrained' | 'blocked';

  /**
   * Semantic width multiplier inside FT2Row.
   * Interpreted ONLY by FT2Row.
   */
  span?: 1 | 2;
};

export function FT2Surface({
  children,
  title,
  variant = 'standard',
  trustTone,
  span = 1,
}: FT2SurfaceProps) {
  const padding =
    variant === 'kpi'
      ? FT2_TOKENS.surfacePadding.kpi
      : FT2_TOKENS.surfacePadding.standard;

  return (
    <Paper
      elevation={0}
      data-ft2-surface
      data-ft2-variant={variant}
      data-ft2-trust={trustTone ?? 'unknown'}
      sx={{
        width: '100%',
        height: '100%',
        minWidth:
          (variant === 'kpi' ? 160 : 240) *
          (span ?? 1),
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',

        backgroundColor: FT2_TOKENS.surface.background,
        // Structural depth
        boxShadow: FT2_TOKENS.surfaceShadow.default,

        /**
         * Trust Boundary
         * --------------
         * Thin, non-verbal epistemic affordance.
         * Attached to surface, not values.
         */
        borderLeft:
          trustTone
            ? `3px solid ${FT2_TOKENS.trustTone[trustTone]}`
            : 'none',
      }}
    >
      {/* ───── Control Zone ───── */}
      <Box
        sx={{
          height: FT2_TOKENS.controlZoneHeight,
          maxWidth: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: padding / 8,
          flexShrink: 0,

          // Visual separation: title vs data
          backgroundColor: FT2_TOKENS.surfaceTitle.background,
          borderBottom: `1px solid ${FT2_TOKENS.surfaceTitle.divider}`,
        }}
      >
        <Box
          data-ft2-surface-title
          sx={{
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {title}
        </Box>

        {/* <IconButton size="small">
          <MoreVertOutlinedIcon fontSize="inherit" />
        </IconButton> */}
      </Box>

      {/* ───── Content Zone ───── */}
      <Box
        data-ft2-surface-content
        sx={{
          px: padding / 8,
          pb: padding / 8,
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {children}
      </Box>
    </Paper>
  );
}
