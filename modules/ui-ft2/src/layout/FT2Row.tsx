/**
 * NOTE
 * ----
 * FT2Row uses a custom span engine.
 * MUI Grid was removed because it introduces a second
 * layout system that conflicts with the span algorithm.
 *
 * Paper is used instead of Box for better theme integration.
 */
import { Paper } from '@mui/material';
import type { ReactNode, ReactElement } from 'react';
import { FT2_TOKENS } from './ft2.tokens.js';

/**
 * LayoutChildProps
 * ----------------
 * Minimal contract required by FT2Row span engine.
 *
 * Any component participating in FT2Row layout
 * must expose an optional `span` prop.
 *
 * This intentionally avoids coupling the row engine
 * to specific container implementations (FT2Panel or any component exposing `span`).
 */
type LayoutChildProps = {
  span?: number;
};

/**
 * PANEL LAYOUT CONTRACT
 * ---------------------
 * FT2Row is intentionally decoupled from specific UI containers.
 *
 * The row engine reads only a minimal `span` contract,
 * allowing any compatible component to participate in layout.
 *
 * Primary container used by FT2 architecture:
 *   FT2Panel
 *
 * Any component exposing `span?: number` may participate.
 */

/**
 * Development mode detection
 * --------------------------
 * Mirrors FT2Panel development instrumentation to allow
 * development-only instrumentation inside FT2Row.
 */
const __DEV__ =
  typeof import.meta !== 'undefined' &&
  (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;

export type FT2RowIntent =
  | 'kpi'
  | 'decision'
  | 'analysis'
  | 'support';

export type FT2RowProps = {
  children: ReactNode;
  intent: FT2RowIntent;
};

export function FT2Row({ children, intent }: FT2RowProps) {
  const rowConfig = FT2_TOKENS.row[intent];
  /**
   * ROW HEIGHT ENFORCEMENT
   * ----------------------
   * Control Tower rows must obey the deterministic
   * height defined in FT2 layout tokens.
   *
   * This creates vertical rhythm across panels and
   * prevents analytical surfaces (charts) from
   * stretching rows unevenly.
   */
  const rowHeight = rowConfig?.height ?? undefined;
  const items = Array.isArray(children) ? children : [children];

    /**
     * Development guard
     * -----------------
     * FT2Row expects children participating in the span contract.
     *
     * If a child does not expose `span`, layout defaults to span = 1.
     *
     * This warning prevents silent layout drift during development.
     */
    if (__DEV__) {
      items.forEach((child) => {
        if (
          typeof child === 'object' &&
          child !== null &&
          'type' in child
        ) {
          const componentName =
            (child as any)?.type?.name ||
            (child as any)?.type?.displayName;
          
          /**
           * Layout child validation
           * -----------------------
           * FT2Row expects children that participate in the span layout contract.
           *
           * Valid children:
           *   - FT2Panel
           *   - Any component exposing `span`
           *
           * This diagnostic prevents accidental placement of raw
           * components that bypass the span engine.
           */
          const props = (child as any)?.props;
          const hasSpanProp = props && 'span' in props;

          if (!hasSpanProp) {
            console.warn(
              `[FT2Row] Child (${componentName}) does not expose a 'span' prop. ` +
              `Components inside FT2Row should implement the span layout contract.`
            );
          }
        }
      });
    }

  /**
   * Extract layout metadata
   * -----------------------
   * During this pass we compute:
   *
   * - span value
   * - child component type
   *
   * This avoids computing diagnostics inside JSX.
   */
  const layoutMeta = items.map((child) => {
    let span = 1;
    let childType = 'unknown';

    if (
      typeof child === 'object' &&
      child !== null &&
      'type' in child
    ) {
      childType =
        (child as any)?.type?.name ||
        (child as any)?.type?.displayName ||
        'anonymous';
    }

    if (
      typeof child === 'object' &&
      child !== null &&
      'props' in child
    ) {
      /**
       * Layout metadata extraction
       * --------------------------
       * Row reads only the `span` property.
       * The component type itself is irrelevant.
       */
      const props = (child as ReactElement<LayoutChildProps>).props;
      span = props?.span ?? 1;
    }

    return { span, childType };
  });

  // 2️⃣ Compute proportional width
  const totalSpan = layoutMeta.reduce((a, b) => a + b.span, 0);
  const unitSize = 12 / totalSpan;

  /**
   * GAP WIDTH
   * ---------
   * Flex gap must be distributed across surfaces,
   * otherwise each surface subtracts the full gap
   * which causes cumulative width overflow.
   */
  const gapPx = FT2_TOKENS.surfaceGap / 8;
  const gapPerSurface = gapPx / items.length;
  const gapCount = items.length > 0 ? items.length - 1 : 0;
  const totalGapWidth = gapPx * gapCount;

  return (
    <Paper
      elevation={0}
      data-ft2-row
      data-ft2-intent={intent}
      sx={{
        display: 'flex',
        flexDirection: 'row',

        /**
         * ROW HEIGHT POLICY
         * -----------------
         * Analytical rows must expand vertically to accommodate
         * stacked signal banners and variable chart content.
         *
         * Fixed heights caused vertical clipping and scrollbars
         * when signal stacks grow.
         */
        minHeight: rowHeight,

        /**
         * VIEWPORT SAFETY RULE
         * --------------------
         * Allow row panels to wrap before horizontal overflow
         * can widen the application frame and push topnav controls
         * outside the viewport.
         *
         * Preserves visibility of global navigation controls.
         */
        flexWrap: 'wrap',

        overflowX: 'hidden',
        overflowY: 'visible',

        gap: `${FT2_TOKENS.surfaceGap / 8}px`,
        alignItems: 'flex-start',
      }}
    >

      {items.map((child, index) => {
        const span = layoutMeta[index]?.span ?? 1;
        const childType = layoutMeta[index]?.childType ?? 'unknown';
        const width = span * unitSize;

        /**
         * Convert span width into percentage of
         * the remaining space after subtracting gaps.
         */
        const widthPercent = (width / 12) * 100;

        return (
          <Paper
            elevation={0}
            key={index}
            data-ft2-span={span}
            data-ft2-child-type={childType}
            sx={{
              display: 'flex',

              /**
               * Layout stability rule
               * ---------------------
               * Flex items must define both width and flexBasis.
               *
               * Without flexBasis, flexbox may recalculate intrinsic
               * width based on content which can cause:
               *
               * - premature wrapping
               * - inconsistent column distribution
               *
               * width + flexBasis ensures span calculation from
               * FT2Row remains deterministic.
               */
              flexShrink: 0,
              /**
               * Allow panels to expand when fewer panels
               * exist on a wrapped row.
               *
               * This ensures remaining panels stretch
               * to occupy available horizontal space.
               */
              flexGrow: 0.75,

              /**
               * GAP-DISTRIBUTED WIDTH
               * ---------------------
               * Each surface subtracts only its share of the gap
               * to prevent cumulative overflow.
               */
              flexBasis: `calc(${widthPercent}% - ${gapPerSurface}px)`,
              width: `calc(${widthPercent}% - ${gapPerSurface}px)`,

              /**
               * CONTROL TOWER SURFACE RULE
               * --------------------------
               * Panel width must be controlled exclusively by the
               * FT2 span engine. Hard minimum widths cause panels
               * to wrap prematurely when container width changes.
               *
               * Setting to 0 allows flexbox to respect span math.
               */
              minWidth: 0,
            }}
          >
            {child}
          </Paper>
        );
      })}
    </Paper>
  );
}