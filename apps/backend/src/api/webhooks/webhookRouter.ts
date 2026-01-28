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
import { getWebhookDispatchMode } from './dispatchMode';
import { enqueueWebhookEnvelope } from './dispatchQueue';

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

    // ─────────────────────────────────────────────
    // Dispatch mode resolution (fail fast)
    // ─────────────────────────────────────────────
    const dispatchMode = getWebhookDispatchMode();

    // 🚨 MUST BE FIRST LEDGER WRITE — NO CONDITIONS ABOVE THIS
    const ledgerResult = await WebhookLedgerService.recordReceived({
      integration: envelope.integration,
      externalEventId: envelope.eventId,
      eventType: envelope.eventType,
      payload: envelope.rawPayload,
      idempotencyKey: `${envelope.integration}:${envelope.eventId}`,
    });

    if (ledgerResult.isDuplicate) {
      await WebhookLedgerService.markDuplicate(envelope.eventId);
      return;
    }

    if (dispatchMode === 'queued') {
      await enqueueWebhookEnvelope(envelope);
      return;
    }

    if (dispatchMode !== 'sync') {
      throw new Error(`Unsupported webhook dispatch mode: ${dispatchMode}`);
    }
    
    const key = WebhookRouter.key(
      envelope.integration,
      envelope.eventType
    );

    console.log('[WEBHOOK DISPATCH]', {
      integration: envelope.integration,
      eventType: JSON.stringify(envelope.eventType),
      registeredKeys: Array.from(WebhookRouter.routes.keys()),
    });

    const handler = WebhookRouter.routes.get(key);

    if (!handler) {
      await WebhookLedgerService.markIgnored(
        envelope.eventId,
        'unsupported_event'
      );
      return;
    }

    try {
      await handler(envelope);
      await WebhookLedgerService.markProcessed(envelope.eventId);
    } catch (err: any) {
      await WebhookLedgerService.markFailed(
        envelope.eventId,
        err?.message ?? 'handler_error'
      );
    }
  }

  private static key(integration: string, eventType: string): string {
    return `${integration}::${eventType}`;
  }
}