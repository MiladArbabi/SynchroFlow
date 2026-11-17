import db, { runWithTenantContext, systemQuery, withTenant } from '@lasyncro/backend-core/db.js';
import { dispatchNotification } from '../notifications/notificationDispatch.service.js';
import { expireStalePickAssignments, type PickNotificationIntent } from './pickAssignment.service.js';

/**
 * SF-PICK-ASSIGN-01 — Pick recovery cycle.
 * ----------------------------------------
 * Returns expired, unclaimed Pick assignments to first-to-claim. Custody
 * (picked_by) is never moved here: a claimed batch stays with its owner until
 * an eligible replacement successfully claims it.
 *
 * Tenants come from list_pick_recovery_tenants() (0233). The idle-alert
 * lister list_active_wms_tenants() and the idle-alert threshold are untouched;
 * the reviewer activity refresh is independent (it moves activity clocks, never
 * assignments).
 */
export async function runPickRecoveryCycle(): Promise<{ shops: number; expired: number }> {
  const lookup = await systemQuery(db.raw('SELECT shop_id FROM public.list_pick_recovery_tenants()'));
  const shops: Array<{ shop_id: number }> = lookup.rows;
  let expired = 0;

  for (const { shop_id: shopId } of shops) {
    try {
      const result = await withTenant(shopId, (trx) => expireStalePickAssignments(trx, shopId));
      expired += result.expired.length;
      if (result.expired.length > 0) {
        console.info('[PICK_ASSIGNMENTS_EXPIRED]', { shopId, batchIds: result.expired });
      }
      // withTenant has committed: notify only now.
      dispatchAfterCommit(shopId, result.notifications);
    } catch (error) {
      console.error('[PICK_RECOVERY] shop cycle failed', {
        shopId,
        error: error instanceof Error ? error.message : error,
      });
    }
  }
  return { shops: shops.length, expired };
}

function dispatchAfterCommit(shopId: number, intents: PickNotificationIntent[]): void {
  for (const intent of intents) {
    // A worker has no request-scoped tenant; the dispatcher reads
    // push_subscriptions through the guarded global db, so give it one.
    runWithTenantContext(shopId, () => dispatchNotification({
      shopId,
      payload: { title: intent.title, body: intent.body, data: { route: '/wms', batchId: intent.batchId } },
      ...(intent.kind === 'user'
        ? { targetUserIds: [intent.userId] }
        : { broadcastToRole: 'operator' as const }),
    })).catch((err: unknown) =>
      console.error('[PICK_RECOVERY_NOTIFICATION_FAILED]', { shopId, error: (err as Error)?.message })
    );
  }
}
