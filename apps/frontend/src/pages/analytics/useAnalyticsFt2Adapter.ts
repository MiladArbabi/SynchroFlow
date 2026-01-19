import type { AnalyticsModuleFT2Props } from '@lasyncro/analytics';

/**
 * mapAnalyticsFt2Props
 *
 * FT2 adapter — identity mapping.
 *
 * Guarantees:
 * - No inference
 * - No defaults
 * - No suppression
 * - Backend truth passes through untouched
 */
export function mapAnalyticsFt2Props(
  snapshot: AnalyticsModuleFT2Props
): AnalyticsModuleFT2Props {
  return snapshot;
}
