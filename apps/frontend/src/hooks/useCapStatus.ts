// apps/frontend/src/hooks/useCapStatus.ts
//
// Cap Status Hook
// ---------------
// Shared threshold logic for any usage-vs-cap UI (banners, meters).
// Single source of truth so cap-warning surfaces can't silently drift
// from each other on what "approaching the limit" means.
//
// Usage:
//   const { pct, level } = useCapStatus(used, cap, [0.8]);           // 1-stage (legacy OrderCapBanner)
//   const { pct, level } = useCapStatus(used, cap, [0.75, 0.9]);     // 2-stage (SEG-023)
//
// CHANGE POLICY:
//   Thresholds are always fractions (0–1), ascending order, last one
//   implicitly maps to 'urgent'. 100%+ is always 'blocked' regardless
//   of thresholds passed in.

export type CapLevel = 'ok' | 'warn' | 'urgent' | 'blocked';

export interface CapStatus {
  /** 0–100, rounded. 0 when cap is infinite or non-positive (unlimited/misconfigured). */
  pct: number;
  level: CapLevel;
}

export function useCapStatus(
  used: number,
  cap: number,
  thresholds: number[] = [0.9],
): CapStatus {
  const infinite = cap === Infinity || cap <= 0;
  if (infinite) return { pct: 0, level: 'ok' };

  const rawPct = used / cap;
  const pct = Math.min(100, Math.round(rawPct * 100));

  if (rawPct >= 1) return { pct, level: 'blocked' };

  // thresholds ascending: first breach → 'warn', last breach → 'urgent'.
  // Single-threshold callers (legacy) only ever see 'warn'.
  const sorted = [...thresholds].sort((a, b) => a - b);
  const urgentAt = sorted[sorted.length - 1];
  const warnAt = sorted[0];

  if (sorted.length > 1 && rawPct >= urgentAt) return { pct, level: 'urgent' };
  if (rawPct >= warnAt) return { pct, level: 'warn' };
  return { pct, level: 'ok' };
}