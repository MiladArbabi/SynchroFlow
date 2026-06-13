// apps/backend/src/utils/analytics.ts
//
// Backend PostHog Analytics (PH-03)
// -----------------------------------
// Server-side event tracking via posthog-node.
//
// ARCHITECTURE:
//   - Singleton client — initialised once, reused everywhere
//   - All events are fire-and-forget (never block business logic)
//   - distinct_id = 'shop_<shopId>' — shop is the unit of revenue
//   - $groups: { shop: shopId } on every event — enables group analytics
//   - Frontend uses user_id as distinct_id + groupByShop() — PostHog links
//     server and client events via the shared group
//
// USAGE:
//   import { captureEvent } from 'utils/analytics.js';
//   captureEvent({ shopId: 1, event: 'trial_started', properties: { tier: 'growth' } });
//
// HARD RULES:
//   - Never await captureEvent in a request handler — fire and forget
//   - Never include PII (email, names) in event properties
//   - Always include shopId — events without group context are useless
//   - POSTHOG_API_KEY must be set in production — missing key = silent no-op

import { PostHog } from 'posthog-node';

/**
 * PostHog Node client — singleton.
 * Lazily initialised on first use so missing env vars don't crash boot.
 */
let _client: PostHog | null = null;

function getClient(): PostHog | null {
  if (_client) return _client;

  const apiKey = process.env.POSTHOG_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV === 'production') {
      console.warn('[analytics] POSTHOG_API_KEY not set — events will not be captured');
    }
    return null;
  }

  _client = new PostHog(apiKey, {
    host: process.env.POSTHOG_HOST ?? 'https://t.lasyncro.com',
    /**
     * flushAt/flushInterval: batch events before sending.
     * Low values for real-time visibility; adjust if volume grows.
     */
    flushAt: 10,
    flushInterval: 5000, // 5 seconds
  });

  console.info('[analytics] PostHog client initialised');
  return _client;
}

export interface CaptureEventParams {
  /** Shop ID — required. Used as group key and distinct_id prefix. */
  shopId: number;
  /** Event name — use dot.notation (trial_started, paywall_hit, etc.) */
  event: string;
  /** Additional properties — no PII */
  properties?: Record<string, string | number | boolean | null>;
}

/**
 * Capture a server-side analytics event.
 *
 * Fire and forget — returns void, never throws.
 * Wrap call sites in try/catch if the surrounding code requires it,
 * but this function itself is safe to call without await.
 */
export function captureEvent({ shopId, event, properties = {} }: CaptureEventParams): void {
  const client = getClient();
  if (!client) return;

  try {
    client.capture({
      distinctId: `shop_${shopId}`,
      event,
      properties: {
        ...properties,
        $groups: { shop: shopId.toString() },
        source: 'backend',
      },
    });
  } catch (err) {
    // Never let analytics crash business logic
    console.warn('[analytics] captureEvent failed (non-fatal)', { event, shopId, err });
  }
}

/**
 * Flush pending events — call on graceful shutdown.
 * Ensures in-flight batched events are sent before process exits.
 */
export async function flushAnalytics(): Promise<void> {
  if (_client) {
    await _client.shutdown();
  }
}