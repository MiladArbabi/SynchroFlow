/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/frontend/src/analytics/adapter.ts

import posthog from 'posthog-js';

/**
 * ANALYTICS ADAPTER
 *
 * Single place where vendors are wired.
 * Swap PostHog / GA / Segment here without touching product code.
 */

/**
 * ADAPTER LAYER
 *
 * Responsible for forwarding events to analytics provider.
 * This is the ONLY place where vendor-specific code exists.
 */

// --- SINGLETON GUARD ---
// Prevent duplicate adapter initialization (Vite HMR / multiple imports)
if ((window as any).__ANALYTICS_ADAPTER_LOADED__) {
  console.warn('[analytics:adapter] duplicate load prevented');
} else {
  (window as any).__ANALYTICS_ADAPTER_LOADED__ = true;
  console.info('[analytics:adapter] MODULE LOADED');
}

export function sendEvent(event: string, payload: Record<string, unknown>) {

  // --- HARD VISIBILITY ---
  console.info('[analytics:adapter:send]', event, payload);

// --- HARD GUARD (SIMPLIFIED + CORRECT) ---
if (!posthog || typeof posthog.capture !== 'function') {
  console.warn('[analytics:adapter] posthog not ready', { event, payload });
  return;
}

 console.info('[analytics:adapter:capture]', event);

 // --- FUNNEL TRACE (DEV ONLY) ---
if (import.meta.env.DEV) {
  (window as any).__FUNNEL_TRACE__ = (window as any).__FUNNEL_TRACE__ || [];
  (window as any).__FUNNEL_TRACE__.push({
    event,
    payload,
    ts: Date.now(),
  });

  console.info('[FUNNEL_TRACE]', (window as any).__FUNNEL_TRACE__);
}

  // --- ACTUAL EMISSION ---
  posthog.capture(event, {
    ...payload,
    source: 'frontend_app',
    ts: Date.now(),
  });
}