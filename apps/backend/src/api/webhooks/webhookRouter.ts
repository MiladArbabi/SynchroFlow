// apps/backend/src/api/webhooks/webhookRouter.ts
//
// Phase 2 – Webhook Router & Dispatcher
//
// Responsibilities:
// - Deterministic routing by (integration + eventType)
// - Exactly-once dispatch (single handler)
// - Fail-closed behavior
// - Ledger is the source of truth for ignored / failed outcomes
//
// Non-responsibilities:
// - Verification (done earlier)
// - Idempotency (ledger layer)
// - Domain logic
// - Payload parsing
//

import { WebhookEnvelope } from './types';
import { WebhookLedgerService } from 'api-src/services/webhook-ledger.service';

type WebhookHandler = (envelope: WebhookEnvelope) => Promise<void>;

interface RouteRegistration {
  integration: string;
  eventType: string;
  handle: WebhookHandler;
}

export class WebhookRouter {
  /**
   * Internal routing table.
   *
   * Key format:
   *   <integration>::<eventType>
   *
   * Example:
   *   shopify::app/uninstalled
   */
  private static routes = new Map<string, WebhookHandler>();

  /**
   * Register a webhook handler.
   *
   * Last-write-wins by design to avoid fan-out.
   * Multiple handlers for the same event is a bug.
   */
  static register(reg: RouteRegistration): void {
    const key = WebhookRouter.key(reg.integration, reg.eventType);
    WebhookRouter.routes.set(key, reg.handle);
  }

  /**
   * Dispatch a verified webhook envelope.
   *
   * Guarantees:
   * - Never throws
   * - Never dispatches more than one handler
   * - Unsupported events are explicitly marked ignored
   * - Handler failures are captured and marked failed
   */
  static async dispatch(envelope: WebhookEnvelope): Promise<void> {
    const key = WebhookRouter.key(
      envelope.integration,
      envelope.eventType
    );

    const handler = WebhookRouter.routes.get(key);

    // ─────────────────────────────────────────────
    // Unsupported event
    // ─────────────────────────────────────────────
    if (!handler) {
      await WebhookLedgerService.markIgnored(
        envelope.eventId,
        'unsupported_event',
        envelope.shopId
      );
      return;
    }

    // ─────────────────────────────────────────────
    // Handler execution (fail-closed)
    // ─────────────────────────────────────────────
    try {
      await handler(envelope);
    } catch (err: any) {
      await WebhookLedgerService.markFailed(
        envelope.eventId,
        err?.message ?? 'handler_error',
        envelope.shopId
      );
    }
  }

  private static key(integration: string, eventType: string): string {
    return `${integration}::${eventType}`;
  }
}