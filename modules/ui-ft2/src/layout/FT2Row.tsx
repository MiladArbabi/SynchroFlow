import { Grid } from '@mui/material';
import type { ReactNode, ReactElement } from 'react';
import { FT2_TOKENS } from './ft2.tokens.js';
import type { FT2SurfaceProps } from './FT2Surface.js';

/**
 * FT2 Layout Grammar
 * ------------------
 *
 * Canonical structure:
 *
 *   FT2Layout
 *     └ FT2Row
 *         └ FT2Surface (controls span)
 *             └ InfoBlock (narrative primitive)
 *
 * Responsibilities
 * ----------------
 *
 * FT2Layout
 *   → page container and vertical rhythm
 *
 * FT2Row
 *   → horizontal composition engine
 *   → computes span distribution
 *
 * FT2Surface
 *   → layout surface
 *   → span and epistemic boundary
 *
 * InfoBlock
 *   → narrative data representation
 *   → NEVER controls layout
 *
 * Historical Note
 * ----------------
 * Earlier implementations allowed InfoBlock directly inside FT2Row,
 * which caused:
 *
 *  - fixed-width layouts
 *  - horizontal scroll dashboards
 *  - unused span system
 *
 * The layout engine now enforces surface-based composition.
 */

/**
 * Development mode detection
 * --------------------------
 * Mirrors FT2Surface implementation to allow
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
     * FT2Row layout is designed to operate on FT2Surface.
     * If other components are placed directly in FT2Row,
     * span logic will degrade to default = 1.
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
           * Structural diagnostic marker
           * ----------------------------
           * If FT2Row receives a non-FT2Surface child we tag it so
           * UI inspectors and automated tests can detect layout violations.
           */
          const isSurface = componentName === 'FT2Surface';

          if (!isSurface) {
            console.warn(
              `[FT2Row] Non-FT2Surface child detected (${componentName}). ` +
              `Wrap content inside <FT2Surface> to enable span control.`
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
      const props = (child as ReactElement<FT2SurfaceProps>).props;
      span = props.span ?? 1;
    }

    return { span, childType };
  });

  // 2️⃣ Compute proportional width
  const totalSpan = layoutMeta.reduce((a, b) => a + b.span, 0);
  const unitSize = 12 / totalSpan;

  return (
    <Grid
      container
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

        return (
          <Grid
            key={index}
            data-ft2-span={span}
            data-ft2-child-type={childType}
            sx={{
              display: 'flex',
              flexShrink: 0,
              minWidth: 'auto',

              /**
               * Apply computed width.
               * Grid uses 12-column baseline.
               */
              width: `${(width / 12) * 100}%`,
            }}
          >
            {child}
          </Grid>
        );
      })}
    </Grid>
  );
}