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
   * Gap-aware span engine
   * ---------------------
   * Flexbox gaps add physical width to the row.
   * If we ignore them the sum of surface widths exceeds 100%,
   * which causes premature wrapping and overlap.
   *
   * We subtract the total gap width before computing surface width.
   */
  const gapPx = FT2_TOKENS.surfaceGap / 8;
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
         * Allow surfaces to respect computed span widths.
         * Horizontal scrolling previously masked layout errors
         * when span logic was inactive.
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
              flexGrow: 0,

              /**
               * Gap-aware width
               *
               * calc() ensures the flex item width accounts
               * for horizontal gaps between surfaces.
               */
              flexBasis: `calc(${widthPercent}% - ${gapPx}px)`,
              width: `calc(${widthPercent}% - ${gapPx}px)`,

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