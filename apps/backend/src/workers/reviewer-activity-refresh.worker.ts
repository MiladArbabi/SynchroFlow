import { refreshReviewerActivity } from '../services/wms/reviewerActivityRefresh.service.js';

const POLL_INTERVAL_MS = 10 * 60_000;
let running = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function configuredShopId(): number | null {
  const value = Number(process.env.REVIEWER_ACTIVITY_REFRESH_SHOP_ID);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * OV-153: disabled by default and deliberately scoped to one explicitly named
 * seed-owned shop. This must never become a general activity simulator because
 * real tenants rely on these clocks for truthful idle detection.
 */
export async function startReviewerActivityRefreshWorker(): Promise<void> {
  if (running) return;

  if (process.env.REVIEWER_ACTIVITY_REFRESH_ENABLED !== 'true') {
    console.info('[reviewer-activity-refresh-worker] disabled');
    return;
  }

  const shopId = configuredShopId();
  if (!shopId) {
    console.error(
      '[reviewer-activity-refresh-worker] enabled without a valid REVIEWER_ACTIVITY_REFRESH_SHOP_ID'
    );
    return;
  }

  running = true;
  console.info('[reviewer-activity-refresh-worker] started', {
    shopId,
    pollIntervalMs: POLL_INTERVAL_MS,
  });

  while (running) {
    try {
      const result = await refreshReviewerActivity(shopId);
      console.info('[REVIEWER_ACTIVITY_REFRESH]', result);
    } catch (error) {
      console.error('[reviewer-activity-refresh-worker] cycle error', {
        shopId,
        error: error instanceof Error ? error.message : error,
      });
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

export function stopReviewerActivityRefreshWorker(): void {
  running = false;
  console.info('[reviewer-activity-refresh-worker] stopped');
}