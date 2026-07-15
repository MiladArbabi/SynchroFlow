import db from '@lasyncro/backend-core/db.js';
import type { Knex } from 'knex';

export type WebhookProcessingStatus =
  | 'received'
  | 'ignored'
  | 'processed'
  | 'failed';

export class WebhookLedgerService {
  // ISS-RLS2: trx defaults to bare `db` for backward compatibility with
  // any caller not yet updated. Always pass the caller's transaction
  // explicitly when one exists — see RLS_blueprint.md §3.
  static async recordReceived(params: {
    shopId?: number | null;
    integration: string;
    externalEventId: string;
    eventType: string;
    payload: unknown;
    idempotencyKey: string;
  }, trx: Knex | Knex.Transaction = db): Promise<boolean> {
    /**
     * INGESTION TRACEABILITY 
     * ---------------------------
     * Persist shop_id at ingestion time to guarantee:
     * - joinability with domain_events
     * - no NULL window in ledger
     */
    if (!params.shopId) {
      console.error('[WEBHOOK_LEDGER_SHOP_ID_REQUIRED]', {
        externalEventId: params.externalEventId,
        integration: params.integration,
        eventType: params.eventType,
      });

      throw new Error('[WEBHOOK_LEDGER_SHOP_ID_REQUIRED]');
    }

    const result = await trx('integration_webhook_events')
      .insert({
        shop_id: params.shopId,
        integration: params.integration,
        external_event_id: params.externalEventId,
        event_type: params.eventType,
        payload: params.payload,
        idempotency_key: params.idempotencyKey,
        processing_status: 'received',
        verified: true,
      })
      .onConflict(['integration', 'external_event_id'])
      .ignore()
      .returning(['external_event_id']);

    /**
     * RELIABLE INSERT DETECTION (CRITICAL)
     * -----------------------------------
     * Postgres returns:
     * - [row] → insert happened
     * - []    → conflict (duplicate)
     */
    const isDuplicate = !result || result.length === 0;

      if (isDuplicate) {
        console.warn('[WEBHOOK_DUPLICATE_IGNORED]', {
          integration: params.integration,
          externalEventId: params.externalEventId,
        });
      }

      /**
       * EXPLICIT IDEMPOTENCY SIGNAL (CRITICAL)
       * --------------------------------------
       * TRUE  → event inserted (first-seen)
       * FALSE → duplicate (must STOP execution upstream)
       */
      return !isDuplicate;
    }

  static async markProcessed(
    externalEventId: string,
    shopId?: number,
    trx: Knex | Knex.Transaction = db
  ): Promise<void> {
    if (shopId === undefined) {
      console.error('[WEBHOOK_LEDGER_SHOP_ID_MISSING_ON_UPDATE]', {
        externalEventId
      });
    }
    await trx('integration_webhook_events')
      .where({ external_event_id: externalEventId })
      .update({
        processing_status: 'processed',
        ...(shopId !== undefined ? { shop_id: shopId } : {}),
      });
  }

  static async markIgnored(
    externalEventId: string,
    reason: string,
    shopId?: number,
    trx: Knex | Knex.Transaction = db
  ): Promise<void> {
    if (shopId === undefined) {
      console.error('[WEBHOOK_LEDGER_SHOP_ID_MISSING_ON_UPDATE]', {
        externalEventId
      });
    }
    await trx('integration_webhook_events')
      .where({ external_event_id: externalEventId })
      .update({
        processing_status: 'ignored',
        processing_error: reason,
        ...(shopId !== undefined ? { shop_id: shopId } : {}),
      });
  }

  static async markFailed(
    externalEventId: string,
    error: string,
    shopId?: number,
    trx: Knex | Knex.Transaction = db
  ): Promise<void> {
    if (shopId === undefined) {
      console.error('[WEBHOOK_LEDGER_SHOP_ID_MISSING_ON_UPDATE]', {
        externalEventId
      });
    }
    await trx('integration_webhook_events')
      .where({ external_event_id: externalEventId })
      .update({
        processing_status: 'failed',
        processing_error: error,
        ...(shopId !== undefined ? { shop_id: shopId } : {}),
      });
  }
}