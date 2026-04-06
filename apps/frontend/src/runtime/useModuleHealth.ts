// apps/frontend/src/runtime/useModuleHealth.ts

import { useConstrainedOrders } from '../pages/orders/useConstrainedOrders';

/**
 * MODULE HEALTH SIGNALS (B-07)
 * ----------------------------
 * Returns a set of module IDs that currently require operator attention.
 *
 * Design rules (UX Consortium §III):
 * - Signal presence only — not count (counts cause anxiety)
 * - Calm dot indicator, not a red badge
 * - Never block navigation — health is ambient, not urgent
 *
 * Currently:
 * - 'fulfillment' → has active constrained orders
 *
 * Extend this hook as new modules gain health signals.
 */
export function useModuleHealth(): Set<string> {
  const { data } = useConstrainedOrders({ limit: 1 });

  const needsAttention = new Set<string>();

  if (data?.data && data.data.length > 0) {
    needsAttention.add('fulfillment');
  }

  return needsAttention;
}