// apps/backend/src/worker-entry.ts

import 'dotenv/config';
import './bootstrap/tsconfig-paths-register';

import { initQueue } from './queue';
import { startSyncWorker } from './sync.worker';
import { startWorker as startEventWorker } from './worker';
import { startProductIngestionWorker } from './workers/product-ingestion.worker';
import { startWebhookWorker } from './workers/webhook-dispatch.worker';
import { startWorker as startReturnsIngestionWorker } from './workers/returnsIngestion.worker';
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
import { enqueueProductForIngestion } from './services/product-ingestion.service';

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
  // startRefundsIngestionWorker(); // DEPRECATED — intentionally disabled

  await runFulfillmentReconciliationBatch(2);
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

 console.log('[worker-entry] All workers started');

 return;
}

start().catch(err => {
  console.error('[worker-entry] Fatal startup error:', err);
  process.exit(1);
});