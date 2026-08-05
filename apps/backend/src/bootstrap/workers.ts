// apps/backend/src/bootstrap/workers.ts
// Lazily start/stop background workers — keep this isolated so server boot is cleaner.
//
// Minimal, backward-compatible update: keep startWorkers/stopWorkers API but also
// attempt to start the Specter ingestion worker when available. Stop functions are
// accumulated and invoked in sequence on shutdown.

let started = false;
let workerStopFns: Array<() => Promise<void> | void> = [];

/**
 * startWorkers
 * - idempotent
 * - each worker may optionally export a stop function which we push into workerStopFns
 */
export async function startWorkers(): Promise<void> {
  if (started) return;
  started = true;

  // start api worker
  try {
    const w = await import('../worker.js');
    if (typeof w.startWorker === 'function') {
      w.startWorker();
      if ((w as any).stopWorker && typeof (w as any).stopWorker === 'function') {
        workerStopFns.push(async () => await (w as any).stopWorker());
      }
      console.log('[bootstrap/workers] API worker started');
    }
  } catch (err) {
    console.warn('[bootstrap/workers] Failed to start API worker (ignored in dev):', err && (err as Error).message ? (err as Error).message : err);
  }

  // start sync worker
  try {
    const s = await import('../sync.worker.js');
    if (typeof s.startSyncWorker === 'function') {
      s.startSyncWorker();
      if ((s as any).stopSyncWorker && typeof (s as any).stopSyncWorker === 'function') {
        workerStopFns.push(async () => await (s as any).stopSyncWorker());
      }
      console.log('[bootstrap/workers] Sync worker started');
    }
  } catch (err) {
    console.warn('[bootstrap/workers] Failed to start Sync worker (ignored in dev):', err && (err as Error).message ? (err as Error).message : err);
  }

  // start Specter ingestion worker (FT0) if present
  try {
    const specter = await import('../workers/specter-ingestion.worker.js');
    if (typeof specter.startSpecterIngestionWorker === 'function') {
      try { await Promise.resolve(specter.startSpecterIngestionWorker()); } catch (_) { /* ignore start error */ }
      if (typeof specter.stopSpecterIngestionWorker === 'function') {
        workerStopFns.push(async () => await specter.stopSpecterIngestionWorker());
      }
      console.log('[bootstrap/workers] Specter ingestion worker started');
    }
  } catch (err) {
    // Not fatal — specter worker may not exist in tests/dev
    console.warn('[bootstrap/workers] Specter ingestion worker not available (skipping):', err && (err as Error).message ? (err as Error).message : err);
  }

  // start Product ingestion worker (FT0)
  try {
    const product = await import('../workers/product-ingestion.worker.js');
    if (typeof product.startProductIngestionWorker === 'function') {
      await Promise.resolve(product.startProductIngestionWorker());
      if (typeof product.stopProductIngestionWorker === 'function') {
        workerStopFns.push(async () => await product.stopProductIngestionWorker());
      }
      console.log('[bootstrap/workers] Product ingestion worker started');

      /**
       * RECONCILIATION CONSUMER
       * -----------------------
       * Consumes fulfillment.reconciliation queue and executes
       * analytical snapshot materialization.
       *
       * Without this worker:
       * - reconciliation queue accumulates
       * - snapshot tables remain empty
       * - Orders UI shows zeros.
       */
      try {
        const reconciliation = await import('../workers/reconciliation/reconciliation.consumer.js');

        /**
         * DISABLED — RECONCILIATION CONSUMER (CRITICAL)
         * ---------------------------------------------
         * Reconciliation MUST execute synchronously inside:
         * processDomainEvent → projection → reconciliation
         *
         * Async consumer causes:
         * - race with projection
         * - AGE_PROJECTION_NOT_MATERIALIZED
         * - non-deterministic rebuilds
         *
         * This is permanently disabled.
         */
        if (typeof reconciliation.startReconciliationConsumer === 'function') {
          console.warn('[RECONCILIATION_CONSUMER_DISABLED]');
          // DO NOT START
        }

        /**
         * EXECUTION WORKER
         * ----------------
         * Consumes execution.jobs.v1 queue and executes decisions.
         *
         * Guarantees:
         * - decision → action pipeline
         * - lifecycle tracking
         * - durable execution via queue
         *
         * Without this worker:
         * - execution queue accumulates
         * - decisions remain unexecuted
         */
        try {
          /**
           * EXECUTION HANDLER REGISTRATION (CRITICAL)
           * -----------------------------------------
           * Must run BEFORE execution worker starts.
           *
           * Guarantees:
           * - All action_types resolve to handlers
           * - Prevents runtime execution failure
           */
          const { registerExecutionHandler, listExecutionHandlers } =
            await import('../execution/execution.registry.js');

          const {
            proceedFulfillmentHandler
          } = await import('../execution/handlers/proceed_fulfillment.handler.js');

          registerExecutionHandler('proceed_fulfillment', proceedFulfillmentHandler);

          const {
            resolveOperationalBlockHandler
          } = await import('../execution/handlers/resolve_operational_block.handler.js');

          registerExecutionHandler('resolve_operational_block', resolveOperationalBlockHandler);

          const {
            resolveInventoryBlockHandler
          } = await import('../execution/handlers/resolve_inventory_block.handler.js');

          registerExecutionHandler('resolve_inventory_block', resolveInventoryBlockHandler);

          const {
            resolveCustomerBlockHandler
          } = await import('../execution/handlers/resolve_customer_block.handler.js');

          registerExecutionHandler('resolve_customer_block', resolveCustomerBlockHandler);

          /**
           * STARTUP VISIBILITY (CRITICAL)
           */
          console.info('[EXECUTION_HANDLERS_REGISTERED]', {
            handlers: listExecutionHandlers()
          });

          /**
           * HANDLER COVERAGE VALIDATION (CRITICAL)
           * --------------------------------------
           * Ensures all emitted action_types are registered.
           *
           * Prevents:
           * - silent production failures
           * - missing handler regressions
           */
          const REQUIRED_ACTIONS = [
            'proceed_fulfillment',
            'resolve_operational_block',
            'resolve_inventory_block',
            'resolve_customer_block'
          ];

          const registered = listExecutionHandlers();

          const missing = REQUIRED_ACTIONS.filter(a => !registered.includes(a));

          if (missing.length > 0) {
            console.error('[EXECUTION_HANDLER_COVERAGE_GAP]', {
              missing,
              registered
            });

            throw new Error('[FATAL] Missing execution handlers');
          }

          const execution = await import('../workers/execution.worker.js');
          const dispatcher = await import('../workers/execution.dispatcher.worker.js');

          if (typeof execution.startExecutionWorker === 'function') {
            execution.startExecutionWorker();

            console.log('[bootstrap/workers] Execution worker started');
          }

          /**
           * EXECUTION DISPATCHER (CRITICAL BRIDGE)
           * --------------------------------------
           * Connects DB → RabbitMQ
           *
           * Must start AFTER execution worker is ready.
           */
          if (typeof dispatcher.startExecutionDispatcher === 'function') {
            dispatcher.startExecutionDispatcher();
            console.log('[bootstrap/workers] Execution dispatcher started');
          }

          /**
           * COMMANDS CONSUMER (THREAD A, 2026-06-30)
           * -----------------------------------------
           * dispatchCommand() (command.bus.ts) has always been
           * write-only — this is the consumer that finally reads
           * pending RECONCILIATION_RUN commands and turns them into
           * real Decision rows via generateDecisions().
           */
          const commandsConsumer = await import('../workers/commands.consumer.js');

          if (typeof commandsConsumer.startCommandsConsumer === 'function') {
            commandsConsumer.startCommandsConsumer();
            console.log('[bootstrap/workers] Commands consumer started');

            if (typeof commandsConsumer.stopCommandsConsumer === 'function') {
              workerStopFns.push(async () => await commandsConsumer.stopCommandsConsumer());
            }
          }
        } catch (err) {
          console.warn(
            '[bootstrap/workers] Execution worker not available:',
            err && (err as Error).message ? (err as Error).message : err
          );
        }

      } catch (err) {
        console.warn(
          '[bootstrap/workers] Reconciliation consumer not available:',
          err && (err as Error).message ? (err as Error).message : err
        );
      }
    }
  } catch (err) {
    console.warn(
      '[bootstrap/workers] Product ingestion worker not available (skipping):',
      err && (err as Error).message ? (err as Error).message : err
    );
  }

  // start WMS batch auto-release worker
  try {
    const wmsAutoRelease = await import('../workers/wms.batch.auto-release.worker.js');
    if (typeof wmsAutoRelease.startWmsBatchAutoReleaseWorker === 'function') {
      // Fire-and-forget — polling loop runs indefinitely, must not block bootstrap
      void wmsAutoRelease.startWmsBatchAutoReleaseWorker();

      if (typeof wmsAutoRelease.stopWmsBatchAutoReleaseWorker === 'function') {
        workerStopFns.push(async () => await wmsAutoRelease.stopWmsBatchAutoReleaseWorker());
      }
      console.log('[bootstrap/workers] WMS batch auto-release worker started');
    }
  } catch (err) {
    console.warn(
      '[bootstrap/workers] WMS auto-release worker not available:',
      err && (err as Error).message ? (err as Error).message : err
    );
  }

  // start shop operational snapshot dispatcher
  // Triggers computeShopOperationalSnapshot per shop after reconciliation.
  // Without this: orders_operational_control_snapshot stays empty → Orders/Overview show zeros.
  try {
    const snapshotDispatcher = await import('../workers/projections/shopSnapshotJob.dispatcher.js');
    if (typeof snapshotDispatcher.startShopSnapshotJobDispatcher === 'function') {
      await Promise.resolve(snapshotDispatcher.startShopSnapshotJobDispatcher()).then(() => {
        console.log('[bootstrap/workers] Shop snapshot dispatcher started');
      }).catch((err) => {
        console.error('[bootstrap/workers] Shop snapshot dispatcher threw during start:', err);
      });
    }
  } catch (err) {
    console.error(
      '[bootstrap/workers] Shop snapshot dispatcher FAILED TO START:',
      err
    );
  }


  // start WMS idle alert worker
  try {
    const wmsIdleAlert = await import('../workers/wms.idle.alert.worker.js');
    if (typeof wmsIdleAlert.startWmsIdleAlertWorker === 'function') {
      void wmsIdleAlert.startWmsIdleAlertWorker();
      if (typeof wmsIdleAlert.stopWmsIdleAlertWorker === 'function') {
        workerStopFns.push(async () => wmsIdleAlert.stopWmsIdleAlertWorker());
      }
      console.log('[bootstrap/workers] WMS idle alert worker started');
    }
  } catch (err) {
    console.warn(
      '[bootstrap/workers] WMS idle alert worker not available:',
      err && (err as Error).message ? (err as Error).message : err
    );
  }

  // OV-153: optional Shopify-review tenant freshness. The worker is inert
  // unless explicitly enabled and independently verifies seed ownership.
  try {
    const reviewerActivity = await import('../workers/reviewer-activity-refresh.worker.js');
    if (typeof reviewerActivity.startReviewerActivityRefreshWorker === 'function') {
      void reviewerActivity.startReviewerActivityRefreshWorker();
      if (typeof reviewerActivity.stopReviewerActivityRefreshWorker === 'function') {
        workerStopFns.push(async () => reviewerActivity.stopReviewerActivityRefreshWorker());
      }
      console.log('[bootstrap/workers] Reviewer activity refresh worker registered');
    }
  } catch (err) {
    console.warn(
      '[bootstrap/workers] Reviewer activity refresh worker not available:',
      err && (err as Error).message ? (err as Error).message : err
    );
  }

  // start trial expiry worker (MON-07)
  try {
    const trialExpiry = await import('../workers/trial-expiry.worker.js');
    if (typeof trialExpiry.startTrialExpiryWorker === 'function') {
      void trialExpiry.startTrialExpiryWorker();
      if (typeof trialExpiry.stopTrialExpiryWorker === 'function') {
        workerStopFns.push(async () => trialExpiry.stopTrialExpiryWorker());
      }
      
      console.log('[bootstrap/workers] Trial expiry worker started');
    }
  } catch (err) {
    console.warn(
      '[bootstrap/workers] Trial expiry worker not available:',
      err && (err as Error).message ? (err as Error).message : err
    );
  }
  // start Shopify uninstall grace-period worker (SHB-08)
  try {
    const shopifyGrace = await import('../workers/shopifyUninstallGrace.worker.js');
    if (typeof shopifyGrace.startShopifyUninstallGraceWorker === 'function') {
      void shopifyGrace.startShopifyUninstallGraceWorker();
      if (typeof shopifyGrace.stopShopifyUninstallGraceWorker === 'function') {
        workerStopFns.push(async () => shopifyGrace.stopShopifyUninstallGraceWorker());
      }
      console.log('[bootstrap/workers] Shopify uninstall grace worker started');
    }
  } catch (err) {
    console.warn(
      '[bootstrap/workers] Shopify uninstall grace worker not available:',
      err && (err as Error).message ? (err as Error).message : err
    );
  }
  // start Shopify billing reconciliation worker (BILL-20) — fallback for
  // missed app_subscriptions/update webhook deliveries
  try {
    const shopifyBillingReconciliation = await import('../workers/shopifyBillingReconciliation.worker.js');
    if (typeof shopifyBillingReconciliation.startShopifyBillingReconciliationWorker === 'function') {
      void shopifyBillingReconciliation.startShopifyBillingReconciliationWorker();
      if (typeof shopifyBillingReconciliation.stopShopifyBillingReconciliationWorker === 'function') {
        workerStopFns.push(async () => shopifyBillingReconciliation.stopShopifyBillingReconciliationWorker());
      }
      console.log('[bootstrap/workers] Shopify billing reconciliation worker started');
    }
  } catch (err) {
    console.warn(
      '[bootstrap/workers] Shopify billing reconciliation worker not available:',
      err && (err as Error).message ? (err as Error).message : err
    );
  }
  // start margin snapshot integrity worker (FIN-02 hardening — read-only drift detector)
  try {
    const marginIntegrity = await import('../workers/margin-snapshot-integrity.worker.js');
    if (typeof marginIntegrity.startMarginSnapshotIntegrityWorker === 'function') {
      void marginIntegrity.startMarginSnapshotIntegrityWorker();
      if (typeof marginIntegrity.stopMarginSnapshotIntegrityWorker === 'function') {
        workerStopFns.push(async () => marginIntegrity.stopMarginSnapshotIntegrityWorker());
      }
      console.log('[bootstrap/workers] Margin snapshot integrity worker started');
    }
  } catch (err) {
    console.warn(
      '[bootstrap/workers] Margin snapshot integrity worker not available:',
      err && (err as Error).message ? (err as Error).message : err
    );
  }

  // start carrier stall detection worker (WM-40 hardening)
  try {
    const carrierStall = await import('../workers/carrier-stall-detection.worker.js');
    if (typeof carrierStall.startCarrierStallDetectionWorker === 'function') {
      void carrierStall.startCarrierStallDetectionWorker();
      if (typeof carrierStall.stopCarrierStallDetectionWorker === 'function') {
        workerStopFns.push(async () => carrierStall.stopCarrierStallDetectionWorker());
      }
      console.log('[bootstrap/workers] Carrier stall detection worker started');
    }
  } catch (err) {
    console.warn(
      '[bootstrap/workers] Carrier stall detection worker not available:',
      err && (err as Error).message ? (err as Error).message : err
    );
  }
  
  // start morning brief worker (OVR-02)
  try {
    const morningBrief = await import('../workers/morning-brief.worker.js');
    if (typeof morningBrief.startMorningBriefWorker === 'function') {
      void morningBrief.startMorningBriefWorker();
      if (typeof morningBrief.stopMorningBriefWorker === 'function') {
        workerStopFns.push(async () => morningBrief.stopMorningBriefWorker());
      }
      console.log('[bootstrap/workers] Morning brief worker started');
    }
  } catch (err) {
    console.warn(
      '[bootstrap/workers] Morning brief worker not available:',
      err && (err as Error).message ? (err as Error).message : err
    );
  }

// start exchange rate worker — fetches daily FX rates for display-only currency conversion
  try {
    const exchangeRate = await import('../workers/exchange-rate.worker.js');
    if (typeof exchangeRate.startExchangeRateWorker === 'function') {
      await exchangeRate.startExchangeRateWorker();
      if (typeof exchangeRate.stopExchangeRateWorker === 'function') {
        workerStopFns.push(async () => exchangeRate.stopExchangeRateWorker());
      }
      console.info('[bootstrap/workers] Exchange rate worker started');
    }
  } catch (err) {
    console.warn(
      '[bootstrap/workers] Exchange rate worker not available:',
      err && (err as Error).message ? (err as Error).message : err
    );
  }
}


export async function stopWorkers(): Promise<void> {
  // run stop functions in sequence, ignore individual errors
  for (const fn of workerStopFns) {
    try { await fn(); } catch (e) { /* ignore per-worker errors */ }
  }
  workerStopFns = [];
  started = false;
  console.log('[bootstrap/workers] Workers stopped');
};