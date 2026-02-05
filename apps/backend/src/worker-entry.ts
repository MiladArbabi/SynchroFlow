// apps/backend/src/worker-entry.ts

import 'dotenv/config';
import './bootstrap/tsconfig-paths-register';

import { initQueue } from './queue';
import { startSyncWorker } from './sync.worker';
import { startWorker as startEventWorker } from './worker';
import { startProductIngestionWorker } from './workers/product-ingestion.worker';
import { startWebhookWorker } from './workers/webhook-dispatch.worker';
import { startWorker as startReturnsIngestionWorker } from './workers/returnsIngestion.worker';
import { startRefundsIngestionWorker } from './workers/refundsIngestion.worker';
import { reconcileOrderFulfillment, startReconciliationConsumer } from './workers/reconciliation';
import { runFulfillmentReconciliationBatch } from './workers/reconciliation';

import { debugBlockedRevenue } from './services/order-execution-intelligence/__debug.blockers';
/**
 * Obligation flag worker
 * ---------------------
 * Imported intentionally but NOT executed.
 *
 * Reason:
 * - Obligation semantics are not yet defined
 * - Execution must be explicit and scheduled
 * - Prevents accidental background writes
 */
import { computeObligationFlags } from './services/order-execution-intelligence/obligationFlags.worker';
import { evaluateCustomerObligations } from './services/order-execution-intelligence/customerObligation.evaluator';
import db from './db';
import { writeOrderRevenueUnits } from './workers/reconciliation/revenue-units.writer';
import { evaluateOperationalObligations } from './services/order-execution-intelligence/operationalObligation.evaluator';

async function start() {
  console.log('[worker-entry] Booting worker runtime…');

  await initQueue();
  console.log('[worker-entry] Queue initialized');

  // Obligation flags are computed by a future scheduled worker.
  // DO NOT call computeObligationFlags() here.
  startSyncWorker();
  startEventWorker();
  startProductIngestionWorker();
  startWebhookWorker();
  startReturnsIngestionWorker();
  console.log('[worker-entry] Starting reconciliation consumer...');
  startReconciliationConsumer();
  startRefundsIngestionWorker();

  /**
  * DEV-ONLY: Obligation evaluation hook
  * ----------------------------------
  * Purpose:
  * - Manual verification during schema bring-up
  * - MUST be removed once scheduled workers exist
  *
  * Rules:
  * - Hardcoded shopId is allowed ONLY here
  * - Never runs implicitly
  */
  if (process.env.NODE_ENV === 'development') {
    const DEV_SHOP_ID = 2;

    // 1. Reconcile ONE explicit order (Phase 6.9.4)
    const CANONICAL_ORDER_ID =
      'gid://shopify/Order/16567328080242';

    console.log(
      '[DEV] Reconciling single order:',
      CANONICAL_ORDER_ID
    );

    // HARD GUARD — do not crash worker if ingestion not complete
    const exists = await db('canonical_orders')
      .where({
        shop_id: DEV_SHOP_ID,
        canonical_order_id: CANONICAL_ORDER_ID,
      })
      .first();

    if (!exists) {
      console.warn(
        '[DEV][SKIP] Canonical order not found at startup, skipping reconciliation:',
        CANONICAL_ORDER_ID
      );
    } else {
      await reconcileOrderFulfillment(CANONICAL_ORDER_ID);
    }

    // 2. Materialize revenue units for ALL reconciled orders
    const orders = await db('canonical_orders')
      .where('shop_id', DEV_SHOP_ID)
      .select('canonical_order_id');

    for (const o of orders) {
      await writeOrderRevenueUnits(DEV_SHOP_ID, o.canonical_order_id);
    }

    // 3. Evaluate customer obligations (v3, SKU-level)
    await evaluateCustomerObligations(DEV_SHOP_ID);

    // 4. Aggregate obligations
    await computeObligationFlags(DEV_SHOP_ID);

    /**
     * Customer Obligation v3 — shop-level evaluation boundary
     * -------------------------------------------------------
     * Required for FT2 coverage semantics.
     * Evaluates ALL existing revenue units.
     */
    await evaluateCustomerObligations(DEV_SHOP_ID);

    /* await evaluateOperationalObligations(DEV_SHOP_ID); */

    await debugBlockedRevenue(DEV_SHOP_ID);
  }

 console.log('[worker-entry] All workers started');

 return;
}

start().catch(err => {
  console.error('[worker-entry] Fatal startup error:', err);
  process.exit(1);
});
