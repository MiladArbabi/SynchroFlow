// tests/unit/backend/webhooks/webhook.registration.test.ts
//
// Phase 5 – Webhook handler registration safety (RED)
//
// Contract:
// - Handlers are registered exactly once
// - Multiple calls to registerWebhookHandlers do NOT duplicate routes
// - System must be safe against accidental double-boot
//

import { WebhookRouter } from 'api-src/api/webhooks/webhookRouter';
import { registerWebhookHandlers } from 'api-src/api/webhooks/registerWebhookHandlers';

// We inspect internal routing state intentionally.
// This is a *composition-level* invariant test.
describe('Webhook handler registration – boot safety', () => {
  beforeEach(() => {
    // @ts-expect-error – test-only access to internal state
    WebhookRouter.routes.clear();
  });

  it('registers all webhook handlers exactly once', () => {
    registerWebhookHandlers();

    // @ts-expect-error – test-only access
    const routesAfterFirstCall = WebhookRouter.routes.size;

    registerWebhookHandlers();

    // @ts-expect-error – test-only access
    const routesAfterSecondCall = WebhookRouter.routes.size;

    expect(routesAfterFirstCall).toBeGreaterThan(0);
    expect(routesAfterSecondCall).toBe(routesAfterFirstCall);
  });

  it('does not create duplicate route keys when called multiple times', () => {
    registerWebhookHandlers();
    registerWebhookHandlers();

    // @ts-expect-error – test-only access
    const keys = Array.from(WebhookRouter.routes.keys());

    const uniqueKeys = new Set(keys);

    expect(uniqueKeys.size).toBe(keys.length);
  });
});