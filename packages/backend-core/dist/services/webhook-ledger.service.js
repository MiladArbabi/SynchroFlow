import db from '@lasyncro/backend-core/db.js';
export class WebhookLedgerService {
    static async recordReceived(params) {
        /**
         * INGESTION TRACEABILITY
         * ---------------------------
         * Persist shop_id at ingestion time to guarantee:
         * - joinability with domain_events
         * - no NULL window in ledger
         */
        if (!params.shopId) {
            console.warn('[WEBHOOK_LEDGER_NO_SHOP_ID]', {
                externalEventId: params.externalEventId,
                integration: params.integration,
                eventType: params.eventType,
            });
        }
        await db('integration_webhook_events').insert({
            shop_id: params.shopId ?? null,
            integration: params.integration,
            external_event_id: params.externalEventId,
            event_type: params.eventType,
            payload: params.payload,
            idempotency_key: params.idempotencyKey,
            processing_status: 'received',
            verified: true,
        });
    }
    static async markProcessed(externalEventId, shopId) {
        await db('integration_webhook_events')
            .where({ external_event_id: externalEventId })
            .update({
            processing_status: 'processed',
            shop_id: shopId ?? null,
        });
    }
    static async markIgnored(externalEventId, reason, shopId) {
        await db('integration_webhook_events')
            .where({ external_event_id: externalEventId })
            .update({
            processing_status: 'ignored',
            processing_error: reason,
            shop_id: shopId ?? null,
        });
    }
    static async markFailed(externalEventId, error, shopId) {
        await db('integration_webhook_events')
            .where({ external_event_id: externalEventId })
            .update({
            processing_status: 'failed',
            processing_error: error,
            shop_id: shopId ?? null,
        });
    }
}
