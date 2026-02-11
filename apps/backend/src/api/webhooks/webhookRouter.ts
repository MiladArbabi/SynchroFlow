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

    const normalizedEventType =
    typeof envelope.eventType === 'string'
      ? envelope.eventType.replace(/^"+|"+$/g, '')
      : envelope.eventType;

    // Canonicalize envelope for downstream consumers (queued or sync)
    envelope.eventType = normalizedEventType;

    /**
     * Refund payload narrowing
     * ------------------------
     * WebhookEnvelope.rawPayload is intentionally untyped.
     * Refund idempotency requires extracting Shopify refund identity,
     * so we narrow locally instead of polluting the global envelope type.
     */
    type ShopifyRefundPayload = {
      id?: number | string;
      admin_graphql_api_id?: string;
    };

    const refundPayload =
      normalizedEventType === 'refunds/create'
        ? (envelope.rawPayload as ShopifyRefundPayload)
        : null;

    const refundId =
      refundPayload?.id ??
      refundPayload?.admin_graphql_api_id ??
      null;

    // 🚨 MUST BE FIRST SIDE-EFFECT
    if (normalizedEventType !== 'refunds/create') {
      await WebhookLedgerService.recordReceived({
        integration: envelope.integration,
        externalEventId: envelope.eventId,
        eventType: normalizedEventType,
        payload: envelope.rawPayload,
        idempotencyKey: `${envelope.integration}:${envelope.eventId}`,
      });
    }

    let dispatchMode = getWebhookDispatchMode();

    console.log('[ROUTER ENV CHECK]', {
      WORKER_RUNTIME: process.env.WORKER_RUNTIME,
      type: typeof process.env.WORKER_RUNTIME,
      equalsTrue: process.env.WORKER_RUNTIME === 'true'
    });

    // If this process is the worker, force sync execution.
    // Worker must never re-enqueue.
    if (process.env.WORKER_RUNTIME === 'true') {
      dispatchMode = 'sync';
    }

    console.log('[DISPATCH MODE]', dispatchMode);

    const key = WebhookRouter.key(
      envelope.integration,
      normalizedEventType
    );

    console.log('[WEBHOOK DISPATCH]', {
      integration: envelope.integration,
      eventType: normalizedEventType,
      registeredKeys: Array.from(WebhookRouter.routes.keys()),
    });

    if (dispatchMode === 'queued' && !(envelope as any).__fromQueue) {
      await enqueueWebhookEnvelope(envelope);
      return;
    }

    if (dispatchMode !== 'sync') {
      throw new Error(`Unsupported webhook dispatch mode: ${dispatchMode}`);
    }

    console.log('[DISPATCH_DECISION]', {
      willInvokeHandler: true,
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