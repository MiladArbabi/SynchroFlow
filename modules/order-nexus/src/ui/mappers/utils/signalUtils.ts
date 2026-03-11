/**
 * Signal Utility Helpers
 * ----------------------
 *
 * Shared helpers used by the operational
 * signal engine.
 *
 * These utilities are intentionally stateless
 * and deterministic.
 */

import type { OperationalSignalSeverity } from '../../../contracts/operationalSignals.js';

/**
 * Generate deterministic signal ID namespace.
 */
export function signalId(type: string): string {
  return `orders:${type}`;
}

/**
 * Prevent log spam by warning only once per key.
 */
export function warnOnce(
  registry: Set<string>,
  key: string,
  message: string,
  payload: unknown,
  maxSize = 100
) {
  const alreadySeen = registry.has(key);

  if (!alreadySeen) {

    if (registry.size >= maxSize) {
      console.warn(
        '[OperationalSignals] metricWarningRegistry capacity reached — registry cleared'
      );
      registry.clear();
    }

    registry.add(key);
    console.warn(message, payload);

  } else {

    console.debug(
      '[OperationalSignals] duplicate metric warning suppressed',
      { key }
    );

  }
}

/**
 * Normalize snapshot metric values.
 */
export function safeMetric(
  value: unknown,
  warn: (key: string, message: string, payload: unknown) => void,
  maxValue = 100000
): number {

  const n = Number(value);

  if (!Number.isFinite(n)) {
    warn(
      `invalid-${value}`,
      '[OperationalSignals] Invalid snapshot metric',
      { value }
    );
    return 0;
  }

  if (n < 0) {
    warn(
      `negative-${value}`,
      '[OperationalSignals] Negative snapshot metric',
      { value }
    );
    return 0;
  }

  if (n > maxValue) {
    warn(
      `excessive-${n}`,
      '[OperationalSignals] Excessive snapshot metric',
      { value: n }
    );
    return maxValue;
  }

  return n;
}

/**
 * Deterministic severity escalation
 * ---------------------------------
 *
 * Operational signals must not depend on wall-clock time.
 * Severity escalation must therefore be driven by
 * projection metrics or explicit lifecycle transitions.
 *
 * Current behavior:
 * - Pass-through severity
 * - Lifecycle engine responsible for escalation in future
 *
 * This preserves deterministic rebuild guarantees.
 */
export function escalateSeverity(
  severity: OperationalSignalSeverity,
  _detectedAt: string,
  _evaluationTime: number
): OperationalSignalSeverity {
  return severity;
}