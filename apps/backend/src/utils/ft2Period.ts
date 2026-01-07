// apps/backend/src/utils/ft2Period.ts

/**
 * FT2 Period Utility
 * ------------------
 * Backend-owned authoritative FT2 window.
 *
 * Rules:
 * - Deterministic
 * - UTC-based
 * - No frontend input
 * - Evolvable without UI changes
 */
export function getFt2Period(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime());
  from.setUTCDate(from.getUTCDate() - 30);

  return {
    from: from.toISOString(),
    to: to.toISOString(),
  };
}