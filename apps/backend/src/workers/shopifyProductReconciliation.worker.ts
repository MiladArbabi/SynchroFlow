// apps/backend/src/workers/shopifyProductReconciliation.worker.ts
//
// GH-1262 A2.2 B1 — drives durable equal-timestamp product reconciliation.
//
// Each cycle is one bounded tick (shopifyProductReconciliation.service):
// identifier-only tenant discovery, at most one claim per tenant, bounded
// concurrency, every claim fenced by token + generation + DB-time lease.
// Provider calls happen only between transactions. Each start owns an
// AbortController: stop aborts it (cancelling in-flight Shopify GraphQL
// requests, uncounted, claim released), wakes the sleep and awaits the
// in-flight cycle; a claim interrupted by process exit is recovered by lease
// expiry.

import { runProductReconciliationTick } from '../services/shopify/shopifyProductReconciliation.service.js';

const RECONCILIATION_INTERVAL_MS = 5_000;
const SLEEP_SLICE_MS = 1_000;
const TENANTS_PER_TICK = 20;
const CLAIM_CONCURRENCY = 4;

let running = false;
let loopPromise: Promise<void> | null = null;
let stopRequested = false;
let wakeSleep: (() => void) | null = null;
let abortController: AbortController | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (wakeSleep === resolve) wakeSleep = null;
      resolve();
    }, ms);
    wakeSleep = () => {
      clearTimeout(timeout);
      if (wakeSleep) wakeSleep = null;
      resolve();
    };
  });
}

async function interruptibleSleep(ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (!stopRequested && Date.now() < deadline) {
    await sleep(Math.min(SLEEP_SLICE_MS, deadline - Date.now()));
  }
}

async function runLoop(signal: AbortSignal): Promise<void> {
  while (!stopRequested) {
    try {
      const result = await runProductReconciliationTick({
        limit: TENANTS_PER_TICK,
        concurrency: CLAIM_CONCURRENCY,
        shouldStop: () => stopRequested,
        signal,
      });
      if (result.claimed > 0) {
        console.info('[SHOPIFY_PRODUCT_RECONCILE_TICK]', result);
      }
    } catch (error) {
      console.error('[SHOPIFY_PRODUCT_RECONCILE_TICK_FAILED]', {
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
    await interruptibleSleep(RECONCILIATION_INTERVAL_MS);
  }
}

export async function startShopifyProductReconciliationWorker(): Promise<void> {
  if (running) return;

  running = true;
  stopRequested = false;
  const controller = new AbortController();
  abortController = controller;
  loopPromise = runLoop(controller.signal).finally(() => {
    running = false;
    loopPromise = null;
    if (abortController === controller) abortController = null;
  });
}

export async function stopShopifyProductReconciliationWorker(): Promise<void> {
  stopRequested = true;
  abortController?.abort();
  wakeSleep?.();
  if (loopPromise) {
    await loopPromise;
  }
}
