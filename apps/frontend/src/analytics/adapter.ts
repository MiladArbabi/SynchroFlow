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

/**
 * IDENTITY FUNCTIONS
 * ──────────────────
 * Called at login, signup, and session hydration.
 * These are NOT events — they set the user identity for all subsequent events.
 *
 * identifyUser(): links PostHog anonymous ID to the real user_id.
 *   - Must be called once per session after auth resolves.
 *   - Links www.lasyncro.com anonymous session to the authenticated user.
 *   - No PII in properties — email deliberately omitted (GDPR consideration).
 *
 * groupByShop(): sets the shop group so all events are attributed to the shop.
 *   - Revenue, churn, and funnel metrics are per-shop, not per-human.
 *   - Must be called alongside identifyUser() — never one without the other.
 */
export function identifyUser(
  userId: number,
  shopId?: number,
  meta?: { plan?: string; trial_ends_at?: string; created_at?: string }
): void {
  if (!posthog || typeof posthog.identify !== 'function') {
    console.warn('[analytics:adapter] posthog.identify not ready');
    return;
  }
  posthog.identify(userId.toString(), {
    shop_id: shopId ?? null,
    plan: meta?.plan ?? null,
    trial_ends_at: meta?.trial_ends_at ?? null,
    created_at: meta?.created_at ?? null,
  });
  console.info('[analytics:adapter:identify]', { userId, shopId, meta });
}

export function groupByShop(shopId: number): void {
  if (!posthog || typeof posthog.group !== 'function') {
    console.warn('[analytics:adapter] posthog.group not ready');
    return;
  }
  posthog.group('shop', shopId.toString());
  console.info('[analytics:adapter:group]', { shopId });
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