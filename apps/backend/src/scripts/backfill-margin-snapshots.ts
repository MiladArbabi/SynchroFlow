// apps/backend/src/scripts/backfill-margin-snapshots.ts
//
// MARGIN SNAPSHOT BACKFILL (dev seed companion)
// ---------------------------------------------
// WHY: dev_seed writes source tables directly (order_revenue_units, etc.) but
// emits NO domain events. order_margin_snapshot is normally written only by the
// reconciliation pipeline (reconciliation.handlers.ts → computeOrderMargin),
// and `rebuild` replays from domain_events — neither exists for seeded data.
// Result without this: Finances/Margin + Intelligence render $0 after a fresh
// seed (the recurring "empty UI" trap).
//
// FIX: invoke the SAME runtime service per seeded order, but from a STANDALONE
// transaction that sets `synchroflow.reconciliation = 'true'` — satisfying the
// order_margin_snapshot write guard (SNAPSHOT_WRITE_BLOCKED) instead of
// bypassing it. Must NOT run inside the seed transaction: a guarded-write throw
// aborts the whole seed and rolls everything back.
//
// USAGE: node dist/src/scripts/backfill-margin-snapshots.js  [shopId=1]
// Wired into dev:setup after the full_data seed.

import db, { systemDb, withTenant } from '@lasyncro/backend-core/db.js';
import { computeOrderMargin } from '../services/margin/computeOrderMargin.service.js';

async function backfillMarginSnapshots(): Promise<void> {
  const shopId = Number(process.argv[2] ?? 1);
  console.info('[MARGIN_BACKFILL] start', { shopId });

  // Enumerate via systemDb (PGMIGRATION_USER) — backfill is a tenant-less
  // admin operation, and a bare db() query on the default pool returned 0
  // rows due to the tenant-context guard. systemDb is the canonical path for
  // cross-tenant admin reads (mirrors how rebuild/migrations enumerate).
  const orders = await systemDb('orders')
    .where({ shop_id: shopId })
    .select('lasyncro_order_id');
  console.info('[MARGIN_BACKFILL] orders found', { count: orders.length });

  // Per-order isolation: a guarded-write failure on a single order aborts
  // its Postgres transaction; without per-order isolation a single failure
  // would cascade. withTenant satisfies RLS + opens the transaction we then
  // augment with synchroflow.reconciliation to authorise the snapshot write
  // (mirrors reconciliation.handlers.ts:89).
  let ok = 0;
  let skipped = 0;

  for (const { lasyncro_order_id: orderId } of orders) {
    try {
      await withTenant(shopId, async (trx) => {
        // withTenant's .d.ts widens trx to Knex; runtime passes a real
        // Knex.Transaction (baseDb.transaction(...)). Cast repairs the type
        // without changing behaviour.
        const ttx = trx as unknown as import('knex').Knex.Transaction;
        // PROJECTION WRITER BYPASS — order_margin_snapshot is guarded by
        // enforce_projection_writer (PROJECTION_WRITE_VIOLATION). Mirrors
        // rebuildInventoryProjection.ts:78 — legitimate backfill outside the
        // projection engine sets the GUC scoped to this transaction.
        await ttx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
        // SNAPSHOT WRITE GUARD — mirrors reconciliation.handlers.ts:89.
        await ttx.raw(`SET LOCAL "synchroflow.reconciliation" = 'true'`);
        // aggregate_version 1 matches the seed's order version.
        await computeOrderMargin(ttx, orderId, shopId, 1);
      });
      ok += 1;
    } catch (err) {
      // Expected for orders with no cost data — computeOrderMargin skips those.
      skipped += 1;
      console.warn('[MARGIN_BACKFILL] skipped', {
        orderId,
        error: (err as Error).message,
      });
    }
  }

  console.info('[MARGIN_BACKFILL] done', { computed: ok, skipped });
  await db.destroy();
  await systemDb.destroy();
}

backfillMarginSnapshots().catch((err) => {
  console.error('[MARGIN_BACKFILL] fatal', err);
  process.exit(1);
});