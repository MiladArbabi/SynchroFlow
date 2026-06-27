import { useConstrainedOrders } from '../pages/orders/useConstrainedOrders';
import { useAlertCount } from '../pages/alerts/useAlerts';

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
 * Modules:
 * - 'fulfillment' → has active constrained orders
 * - 'alerts'      → has active alerts requiring attention
 */
export function useModuleHealth(): Set<string> {
  const { data } = useConstrainedOrders({ limit: 1 });
  const alertCount = useAlertCount();

  const needsAttention = new Set<string>();

  if (data?.data && data.data.length > 0) {
    needsAttention.add('fulfillment');
  }

  if (alertCount > 0) {
    needsAttention.add('alerts');
  }

  return needsAttention;
}