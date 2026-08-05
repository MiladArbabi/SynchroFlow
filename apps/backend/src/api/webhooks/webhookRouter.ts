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
import type { Knex } from 'knex';
import db, { systemQuery } from '@lasyncro/backend-core/db.js';
import { WebhookEnvelope } from './types.js';
import { WebhookLedgerService } from '@lasyncro/backend-core/services/webhook-ledger.service.js';
import { getWebhookDispatchMode } from './dispatchMode.js';
import { enqueueWebhookEnvelope } from './dispatchQueue.js';
import { buildExternalEventId } from './buildExternalEventId.js';

// ISS-RLS2: handlers now receive the router's tenant-scoped transaction
// instead of importing the bare `db` singleton internally. Every handler
// MUST use this trx for all queries — see RLS_blueprint.md §3.
type WebhookHandler = (envelope: WebhookEnvelope, trx: Knex.Transaction) => Promise<void>;

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
      /**
       * SHOP RESOLUTION (CRITICAL LINKAGE)
       * ----------------------------------
       * Required to ensure:
       * - webhook ledger ↔ domain_events joinability
       * - full ingestion traceability
       *
       * Pre-tenant resolution returns only shop_id through the same narrow
       * SECURITY DEFINER function used by the App Store reinstall path.
       */
      let shopId: number | null = null;
    /**
     * LEDGER INGESTION (UNIFIED)
     * --------------------------
     * All webhook events, including refunds, must first
     * enter integration_webhook_events ledger.
     *
     * Refund idempotency at execution layer remains additive.
     */
    if (!(envelope as any).__fromQueue) {
      if (envelope.shopId) {
        // Already resolved upstream (e.g. Sendcloud: resolved via per-shop
        // webhook token during signature verification, before this envelope
        // was even built — no shopDomain concept exists for this provider).
        shopId = envelope.shopId;
      } else if (envelope.shopDomain) {
        const lookup = await systemQuery(
          db.raw(
            'SELECT shop_id FROM public.resolve_shopify_reinstall_shop(?)',
            [envelope.shopDomain]
          )
        );
        const installation = lookup.rows[0];
        if (installation) {
          shopId = installation.shop_id;
        } else {
          console.error('[WEBHOOK_SHOP_RESOLUTION_FAILED]', {
            eventId: envelope.eventId,
            shopDomain: envelope.shopDomain,
          });
          /**
           * HARD FAIL (CRITICAL)
           * --------------------
           * shop_id is REQUIRED for:
           * - RLS
           * - ledger integrity
           * - downstream processing
           *
           * Continuing causes DB constraint violation and crashes.
           */
          throw new Error('[WEBHOOK_SHOP_RESOLUTION_HARD_FAIL]');
        }
      }
      if (!shopId) {
        throw new Error('[WEBHOOK_MISSING_SHOP_ID]');
      }
      const resolvedShopId = shopId;
      // SHB-16: write resolved shopId back onto the envelope — resolution
      // above only produces a local variable; handlers reading
      // envelope.shopId (e.g. handleAppSubscriptionUpdate) got undefined
      // otherwise. resolvedShopId remains the single source of truth for
      // SET LOCAL/ledger calls within this function; this line just
      // propagates it forward for handlers dispatched below.
      envelope.shopId = resolvedShopId;

      /**
       * ISS-RLS2 FIX
       * ------------
       * The entire ledger + dispatch + ledger-mark flow now runs inside
       * ONE transaction with SET LOCAL app.current_tenant. This replaces
       * the prior bare `db.raw('SET app.current_tenant = ...')` (no
       * LOCAL, no transaction) which silently relied on connection-pool
       * leakage to work at all — see RLS_blueprint.md §3 and §7.
       *
       * CRITICAL: handler errors are caught and markFailed is written
       * INSIDE this transaction, but we do NOT throw inside the
       * transaction callback — a throw here would roll back the
       * markFailed write itself. The captured error is re-thrown AFTER
       * the transaction commits, so the HTTP layer still returns 500
       * and Shopify still retries delivery.
       */
      let capturedError: any = null;

      await db.transaction(async (trx) => {
        await trx.raw(`SET LOCAL app.current_tenant = '${resolvedShopId}'`);

        const isFirstSeen = await WebhookLedgerService.recordReceived({
          shopId: resolvedShopId,
          integration: envelope.integration,
          externalEventId: envelope.eventId,
          eventType: normalizedEventType,
          payload: envelope.rawPayload,
          idempotencyKey: `${envelope.integration}:${envelope.eventId}`,
        }, trx);

        /**
         * HARD IDEMPOTENCY GUARD (CRITICAL)
         * ---------------------------------
         * Prevents:
         * - duplicate handler execution
         * - duplicate domain events
         * - projection inconsistencies
         *
         * Ledger is source of truth.
         */
        if (!isFirstSeen) {
          console.warn('[WEBHOOK_DUPLICATE_STOPPED_AT_ROUTER]', {
            eventId: envelope.eventId,
            integration: envelope.integration,
          });
          return;
        }

        /**
         * DISPATCH MODE RESOLUTION (CANONICAL SAFE)
         * ------------------------------------------
         * Canonical domain-event layer replaces legacy webhook queue.
         *
         * If canonical layer is enabled (DISABLE_CANONICAL_LAYER !== 'true'),
         * we MUST force synchronous handler execution.
         *
         * Queued mode is forbidden without webhook worker.
         */
        let dispatchMode = getWebhookDispatchMode();

        const canonicalEnabled =
          process.env.DISABLE_CANONICAL_LAYER !== 'true';

        if (canonicalEnabled && dispatchMode === 'queued') {
          console.warn('[WEBHOOK_MODE_OVERRIDE] Forcing sync due to canonical layer');
          dispatchMode = 'sync';
        }

        console.log('[ROUTER ENV CHECK]', {
          WORKER_RUNTIME: process.env.WORKER_RUNTIME,
          type: typeof process.env.WORKER_RUNTIME,
          equalsTrue: process.env.WORKER_RUNTIME === 'true'
        });

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

        /**
         * HARD GUARD — queued mode requires webhook worker.
         * -------------------------------------------------
         * If canonical layer is active and we reach here,
         * ingestion would be short-circuited.
         */
        if (
          dispatchMode === 'queued' &&
          process.env.DISABLE_CANONICAL_LAYER !== 'true'
        ) {
          console.error('[WEBHOOK_QUEUE_FORBIDDEN_UNDER_CANONICAL]');
          throw new Error('Webhook queued mode not allowed under canonical layer');
        }

        if (dispatchMode === 'queued' && !(envelope as any).__fromQueue) {
          await enqueueWebhookEnvelope(envelope);
          return;
        }

        // If message is coming from queue, execute synchronously.
        if ((envelope as any).__fromQueue) {
          dispatchMode = 'sync';
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
            'unsupported_event',
            resolvedShopId,
            trx
          );

          /**
           * INGESTION GAP FIX
           * ------------------
           * Unsupported events MUST still be persisted
           * into domain_events for:
           * - full audit trail
           * - future backfills
           * - replay when handlers are introduced
           */
          try {
            const installation = envelope.shopDomain
              ? await trx('shopify_app_installations')
                  .where({ shop_domain: envelope.shopDomain })
                  .select('shop_id')
                  .first()
              : null;

            if (installation) {
              await trx('domain_events').insert({
                shop_id: installation.shop_id,
                event_type: `${envelope.eventType}.unsupported`,
                event_payload: envelope.rawPayload,
                event_time: new Date(),
                event_version: 1,
                external_event_id: buildExternalEventId({
                  source: 'webhook',
                  integration: envelope.integration,
                  eventId: envelope.eventId,
                  suffix: 'unsupported',
                }),
              });
            } else {
              console.error('[UNSUPPORTED_EVENT_NO_SHOP]', {
                eventId: envelope.eventId,
                shopDomain: envelope.shopDomain,
              });
            }
          } catch (err) {
            console.error('[UNSUPPORTED_EVENT_PERSIST_FAILED]', {
              eventId: envelope.eventId,
              error: err,
            });
          }

          return;
        }

        try {
          await handler(envelope, trx);

          await WebhookLedgerService.markProcessed(
            envelope.eventId,
            resolvedShopId,
            trx
          );

        } catch (err: any) {
          console.error('[WEBHOOK_HANDLER_ERROR]', {
            eventId: envelope.eventId,
            eventType: normalizedEventType,
            error: err?.message,
          });
          await WebhookLedgerService.markFailed(
            envelope.eventId,
            err?.message ?? 'handler_error',
            resolvedShopId,
            trx
          );
          // Captured, not thrown here — see comment above this transaction.
          capturedError = err;
        }
      });

      /**
       * RETHROW (CRITICAL)
       * ------------------
       * Caller must receive the error so HTTP layer
       * returns 500 → Shopify retries delivery.
       * Swallowing here causes silent permanent ingestion loss.
       * Thrown AFTER commit so markFailed's write survives.
       */
      if (capturedError) {
        throw capturedError;
      }

      return;
    }
  }

  private static key(integration: string, eventType: string): string {
    return `${integration}::${eventType}`;
  }
}
