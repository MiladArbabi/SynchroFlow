// apps/backend/src/workers/margin-snapshot-integrity.worker.ts

import db, { systemQuery, withTenant } from '@lasyncro/backend-core/db.js';

/**
 * MARGIN SNAPSHOT INTEGRITY WORKER (FIN-02 hardening — 2026-06-23)
 * ----------------------------------------------------------------
 * Read-only drift detector for order_margin_snapshot.
 *
 * WHY:
 * - order_margin_snapshot.gross_revenue is version-gated (idempotency guard
 *   in orderMarginProjection.ts / computeOrderMargin.service.ts). If a writer
 *   ever seals a row at aggregate_version N with wrong revenue, the >= guard
 *   permanently blocks correction at the same version — the snapshot silently
 *   serves stale/incorrect data (root cause of FIN-02).
 * - The original FIN-02 source bug (revenue dropped cost-less line items) is
 *   fixed at source. This worker is recurrence insurance: it detects ANY future
 *   divergence between the snapshot and the live revenue truth.
 *
 * WHAT:
 * - Compares order_margin_snapshot.gross_revenue against the authoritative
 *   live sum (order_revenue_units_net.net_revenue) per order.
 * - Emits a structured health signal. DOES NOT WRITE — detection only, so it
 *   can never itself corrupt the ledger. A drifted order is surfaced for a
 *   targeted rebuild/recompute decision by an operator/engineer.
 *
 * Runs every 5 min — low overhead, high-value early warning.
 */

const POLL_INTERVAL_MS = 300_000; // 5 minutes

/**
 * DRIFT QUERY
 * -----------
 * snapshot.gross_revenue (rounded) <> SUM(net_revenue) (rounded) per order.
 * net_revenue is the carrier/return-adjusted truth the projection itself uses,
 * so any mismatch is a genuine integrity gap, not a rounding artefact.
 */
async function checkMarginSnapshotIntegrity(): Promise<void> {
  const locatorResult = await systemQuery(
    db.raw('SELECT * FROM public.list_margin_drift_tenants()')
  );
  const locators = locatorResult.rows as Array<{
    shop_id: number;
    lasyncro_order_id: string;
  }>;
  const rows: Array<{
    shop_id: number;
    lasyncro_order_id: string;
    snapshot_revenue: string;
    live_revenue: string;
  }> = [];

  for (const locator of locators) {
    const row = await withTenant(locator.shop_id, (trx) =>
      trx('order_margin_snapshot AS snapshot')
        .join(
          'order_revenue_units_net AS net',
          'net.lasyncro_order_id',
          'snapshot.lasyncro_order_id'
        )
        .where({
          'snapshot.shop_id': locator.shop_id,
          'snapshot.lasyncro_order_id': locator.lasyncro_order_id,
        })
        .groupBy(
          'snapshot.shop_id',
          'snapshot.lasyncro_order_id',
          'snapshot.gross_revenue'
        )
        .select(
          'snapshot.shop_id',
          'snapshot.lasyncro_order_id',
          trx.raw('ROUND(snapshot.gross_revenue::numeric, 2) AS snapshot_revenue'),
          trx.raw('ROUND(SUM(net.net_revenue)::numeric, 2) AS live_revenue')
        )
        .first()
    );
    if (row) rows.push(row);
  }

  if (rows.length === 0) {
    console.info('[MARGIN_SNAPSHOT_INTEGRITY_OK]', { drifted_orders: 0 });
    return;
  }

  // Drift present — surface loudly. Each row is an order whose stored margin
  // revenue no longer matches live revenue (likely a version-sealed stale row).
  console.error('[MARGIN_SNAPSHOT_INTEGRITY_DRIFT]', {
    drifted_orders: rows.length,
    sample: rows.slice(0, 10).map((r) => ({
      shop_id: r.shop_id,
      order_id: r.lasyncro_order_id,
      snapshot: r.snapshot_revenue,
      live: r.live_revenue,
    })),
    remediation:
      'Run rebuild-from-events (or targeted recompute) for the listed orders.',
  });
}

let intervalHandle: NodeJS.Timeout | null = null;

export async function startMarginSnapshotIntegrityWorker(): Promise<void> {
  console.info('[MARGIN_SNAPSHOT_INTEGRITY_WORKER_STARTED]', {
    poll_interval_ms: POLL_INTERVAL_MS,
  });
  // Run immediately on startup, then poll.
  await checkMarginSnapshotIntegrity();
  intervalHandle = setInterval(async () => {
    try {
      await checkMarginSnapshotIntegrity();
    } catch (err) {
      console.error('[MARGIN_SNAPSHOT_INTEGRITY_WORKER_ERROR]', {
        error: (err as Error).message,
      });
    }
  }, POLL_INTERVAL_MS);
}

export async function stopMarginSnapshotIntegrityWorker(): Promise<void> {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
