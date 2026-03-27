// apps/backend/src/projection/handlers/orders.sync_started.ts

/**
 * PROJECTION — orders/sync_started
 * --------------------------------
 * PURPOSE:
 * - Lifecycle trigger event
 * - No direct state mutation here
 *
 * WHY:
 * - Projection engine requires handler
 * - Lifecycle transition handled elsewhere
 */
export async function handleOrdersSyncStarted() {
  console.info('[projection][orders_sync_started][noop]');
}