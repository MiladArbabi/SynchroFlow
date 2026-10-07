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

    /**
     * FAILED-EVENT RETRY CLAIM (GH-1224)
     * ----------------------------------
     * A failed delivery is retryable: the provider redelivers the same
     * event id after our 500. Reclaim failed → received so this delivery
     * owns the retry, clearing the stale error for the new attempt.
     *
     * SKIP LOCKED (CRITICAL): a delivery arriving while another retry owns
     * the row must NOT wait on its lock — waiting would let it reclaim the
     * row after that owner commits failed, creating a second owner in the
     * same delivery wave. It skips instead and falls through to the
     * existence check below. received_at / payload are left untouched.
     */
    const reclaimed = await trx.raw(
      `
        WITH retry_candidate AS (
          SELECT id
          FROM integration_webhook_events
          WHERE shop_id = ?
            AND integration = ?
            AND external_event_id = ?
            AND processing_status = 'failed'
          FOR UPDATE SKIP LOCKED
        )
        UPDATE integration_webhook_events AS event
        SET processing_status = 'received',
            processing_error = NULL
        FROM retry_candidate
        WHERE event.id = retry_candidate.id
        RETURNING event.id
      `,
      [params.shopId, params.integration, params.externalEventId]
    );

    if (reclaimed.rows.length > 0) {
      console.warn('[WEBHOOK_FAILED_EVENT_RECLAIMED]', {
        integration: params.integration,
        externalEventId: params.externalEventId,
      });
      return true;
    }

    /**
     * EXISTENCE CHECK (CRITICAL)
     * --------------------------
     * Plain MVCC read, no locking. A visible row is received / processed /
     * ignored, or a failed row SKIP LOCKED skipped because another retry
     * owns it — never a row this delivery may process.
     */
    const existing = await trx('integration_webhook_events')
      .where({
        shop_id: params.shopId,
        integration: params.integration,
        external_event_id: params.externalEventId,
      })
      .first('id');

    if (existing) {
      console.warn('[WEBHOOK_DUPLICATE_IGNORED]', {
        integration: params.integration,
        externalEventId: params.externalEventId,
      });
      return false;
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
     * - []    → conflict (lost a concurrent first-insert race)
     *
     * A conflict is NEVER followed by a failed-row reclaim: the concurrent
     * winner may still fail and commit failed, and this in-flight delivery
     * must not become a second owner. A later redelivery may retry.
     */
    const isDuplicate = !result || result.length === 0;

      if (isDuplicate) {
        console.warn('[WEBHOOK_DUPLICATE_IGNORED]', {
          integration: params.integration,
          externalEventId: params.externalEventId,
        });
      }

      /**
       * PROCESSING OWNERSHIP SIGNAL (CRITICAL)
       * --------------------------------------
       * TRUE  → this delivery claimed the event for processing
       *         (new insert, or reclaimed failed event)
       * FALSE → not claimed (must STOP execution upstream)
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