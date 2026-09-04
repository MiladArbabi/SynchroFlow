/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/frontend/src/analytics/adapter.ts

import posthog from 'posthog-js';
import { shouldEnableFrontendAnalytics } from './environment';
import { getAnalyticsConsent } from './googleAnalytics';

function isProductionAnalyticsRuntime(): boolean {
  return shouldEnableFrontendAnalytics({
    hostname: window.location.hostname,
    mode: import.meta.env.MODE,
  });
}

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
type IdentityMeta = {
  plan?: string;
  trial_ends_at?: string;
  created_at?: string;
};

let pendingIdentity: {
  userId: number;
  shopId?: number;
  meta?: IdentityMeta;
} | null = null;

let pendingShopId: number | null = null;

function isPostHogReady(): boolean {
  return (window as any).__LASYNCRO_POSTHOG_READY__ === true;
}

function canUsePostHog(): boolean {
  if (!isProductionAnalyticsRuntime()) return false;
  if (getAnalyticsConsent() !== 'granted') return false;
  if (!isPostHogReady()) return false;
  return true;
}

function flushPendingIdentity(): void {
  if (!canUsePostHog()) return;

  if (pendingIdentity && typeof posthog.identify === 'function') {
    const { userId, shopId, meta } = pendingIdentity;

    posthog.identify(userId.toString(), {
      shop_id: shopId ?? null,
      plan: meta?.plan ?? null,
      trial_ends_at: meta?.trial_ends_at ?? null,
      created_at: meta?.created_at ?? null,
    });

    console.info('[analytics:adapter:identify]', { userId, shopId, meta });
    pendingIdentity = null;
  }

  if (pendingShopId !== null && typeof posthog.group === 'function') {
    posthog.group('shop', pendingShopId.toString());
    console.info('[analytics:adapter:group]', { shopId: pendingShopId });
    pendingShopId = null;
  }
}

window.addEventListener('lasyncro:posthog-ready', flushPendingIdentity);

export function identifyUser(
  userId: number,
  shopId?: number,
  meta?: IdentityMeta
): void {
  if (!isProductionAnalyticsRuntime()) return;

  pendingIdentity = { userId, shopId, meta };
  flushPendingIdentity();
}

export function groupByShop(shopId: number): void {
  if (!isProductionAnalyticsRuntime()) return;

  pendingShopId = shopId;
  flushPendingIdentity();
}

export function resetAnalyticsIdentity(): void {
  if (!isProductionAnalyticsRuntime()) return;

  // Prevent a user who logged out before granting consent from being
  // replayed later when PostHog becomes ready.
  pendingIdentity = null;
  pendingShopId = null;

  if (getAnalyticsConsent() !== 'granted') return;
  if (!isPostHogReady()) return;

  if (!posthog || typeof posthog.reset !== 'function') {
    console.warn('[analytics:adapter] posthog.reset not ready');
    return;
  }

  posthog.reset();
  console.info('[analytics:adapter:reset]');
}

export function sendEvent(event: string, payload: Record<string, unknown>) {

  // --- HARD VISIBILITY ---
  console.info('[analytics:adapter:send]', event, payload);

// --- FUNNEL TRACE (DEV ONLY — local only, never emitted remotely) ---
if (import.meta.env.DEV) {
  (window as any).__FUNNEL_TRACE__ = (window as any).__FUNNEL_TRACE__ || [];
  (window as any).__FUNNEL_TRACE__.push({
    event,
    payload,
    ts: Date.now(),
  });
}

if (!isProductionAnalyticsRuntime()) return;
if (getAnalyticsConsent() !== 'granted') return;
if (!isPostHogReady()) return;

// --- HARD PROVIDER GUARD ---
if (!posthog || typeof posthog.capture !== 'function') {
  console.warn('[analytics:adapter] posthog not ready', { event, payload });
  return;
}

console.info('[analytics:adapter:capture]', event);

  // --- ACTUAL EMISSION ---
  posthog.capture(event, {
    ...payload,
    source: 'frontend_app',
    ts: Date.now(),
  });
}