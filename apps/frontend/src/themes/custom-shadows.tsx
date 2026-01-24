/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/frontend/src/themes/custom-shadows.ts
// ==========================================================
// LaSyncro Custom Shadows — FINAL
//
// Principles:
// - Shadows express DEPTH, not meaning
// - No colored or semantic shadows
// - Mode-aware, neutral-only
// - One consistent shadow language across the app
// ==========================================================

import { ThemeMode } from 'config';
import { withAlpha } from 'utils/colorUtils';

/**
 * createShadow
 * ------------
 * Generates neutral elevation shadows based on surface contrast.
 * No brand, no signal, no semantic coupling.
 */
function createShadow(baseColor: string) {
  const soft = withAlpha(baseColor, 0.16);
  const medium = withAlpha(baseColor, 0.24);

  return {
    z1: `0 1px 2px 0 ${soft}`,
    z8: `0 8px 16px 0 ${soft}`,
    z12: `0 12px 24px 0 ${soft}`,
    z16: `0 16px 32px 0 ${medium}`,
    z20: `0 20px 40px 0 ${medium}`,
    z24: `0 24px 48px 0 ${medium}`
  };
}

/**
 * CustomShadows
 * -------------
 * Public API used by theme.
 *
 * Shadow color is derived ONLY from mode:
 * - Dark mode → soft white shadow
 * - Light mode → soft black shadow
 */
export default function CustomShadows(_palette: any, mode: ThemeMode) {
  const baseColor =
    mode === ThemeMode.DARK
      ? '#FFFFFF'
      : '#000000';

  return createShadow(baseColor);
}
