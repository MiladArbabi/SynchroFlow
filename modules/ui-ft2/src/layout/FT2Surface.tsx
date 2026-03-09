import {
  Box,
  Paper,
  IconButton,
} from '@mui/material';
import { FT2_TOKENS } from './ft2.tokens.js';

const __DEV__ =
  typeof import.meta !== 'undefined' &&
  (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;

function hasRawTextChild(children: unknown): boolean {
  if (typeof children === 'string' || typeof children === 'number') {
    return true;
  }

  if (Array.isArray(children)) {
    return children.some(
      (child) => typeof child === 'string' || typeof child === 'number'
    );
  }

  return false;
}

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
   * Surface span inside FT2Row
   * --------------------------
   *
   * Defines proportional width of this surface relative
   * to other surfaces inside the same FT2Row.
   *
   * Example:
   *
   *   <FT2Row>
   *     <FT2Surface span={1}/>
   *     <FT2Surface span={1}/>
   *     <FT2Surface span={2}/>
   *   </FT2Row>
   *
   * Layout result:
   *
   *   25% | 25% | 50%
   *
   * Implementation details:
   *
   * - FT2Row reads `span` from each child surface
   * - totalSpan is computed
   * - width = span / totalSpan
   *
   * Important rules:
   *
   * 1. FT2Surface must be the direct child of FT2Row
   * 2. InfoBlock must be nested inside FT2Surface
   * 3. Surfaces without span default to span = 1
   *
   * Historical context:
   *
   * Earlier implementations ignored span and relied
   * on fixed-width InfoBlocks, which caused horizontal
   * scrolling dashboards and layout drift.
   *
   * The span contract now drives deterministic layout.
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
  const isKpi = variant === 'kpi';

  if (__DEV__ && hasRawTextChild(children)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[FT2Surface] Raw text children detected${
        title ? ` in surface "${title}"` : ''
      }.\n` +
        `Use <FT2Stat>, <FT2Ratio>, or <FT2Text> instead.\n` +
        `Raw strings bypass FT2 typography invariants.`
    );
  }

  return (
    <Paper
      elevation={0}
      data-ft2-surface
      data-ft2-variant={variant}
      data-ft2-trust={trustTone ?? 'unknown'}
      sx={{
        width: '100%',
        height: '100%',
        /**
       * Layout contract with FT2Row
       * ---------------------------
       * FT2Row owns horizontal span calculation.
       * Surfaces must not enforce fixed pixel width.
       *
       * Historical note:
       * Previous implementation used pixel minWidth
       * which caused:
       *  - premature wrapping
       *  - ghost whitespace
       *  - broken span layouts
       *
       * Surfaces now respect the width provided
       * by the FT2Row layout engine.
       */
      minWidth: 0,
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
            ...FT2_TOKENS.typography.surfaceTitle,

            flex: 1,
            textAlign: 'center',

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

      <Box
        data-ft2-surface-content
        sx={{
          px: padding / 8,
          pb: padding / 8,
          flex: 1,
          minHeight: 0,

          /**
           * FT2 Content Normalization
           * ------------------------
           * KPI surfaces enforce scalar readability.
           * Analytical surfaces remain neutral.
           */
          display: 'flex',
          flexDirection: 'column',
          justifyContent: isKpi ? 'center' : 'flex-start',
          alignItems: isKpi ? 'center' : 'stretch',
          textAlign: isKpi ? 'center' : 'left',

          /**
           * Typography baseline
           */
          ...(isKpi
            ? FT2_TOKENS.typography.kpiValue
            : FT2_TOKENS.typography.body),

          /**
           * Vertical rhythm
           */
          gap: isKpi ? 0.5 : 1,

          /**
           * Safety
           */
          overflow: 'hidden',
        }}
      >
        {children}
      </Box>
    </Paper>
  );
}
