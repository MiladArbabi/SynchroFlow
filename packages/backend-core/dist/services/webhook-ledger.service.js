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
            console.error('[WEBHOOK_LEDGER_SHOP_ID_REQUIRED]', {
                externalEventId: params.externalEventId,
                integration: params.integration,
                eventType: params.eventType,
            });
            throw new Error('[WEBHOOK_LEDGER_SHOP_ID_REQUIRED]');
        }
        await db('integration_webhook_events').insert({
            shop_id: params.shopId,
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
        if (shopId === undefined) {
            console.error('[WEBHOOK_LEDGER_SHOP_ID_MISSING_ON_UPDATE]', {
                externalEventId
            });
        }
        await db('integration_webhook_events')
            .where({ external_event_id: externalEventId })
            .update({
            processing_status: 'processed',
            ...(shopId !== undefined ? { shop_id: shopId } : {}),
        });
    }
    static async markIgnored(externalEventId, reason, shopId) {
        if (shopId === undefined) {
            console.error('[WEBHOOK_LEDGER_SHOP_ID_MISSING_ON_UPDATE]', {
                externalEventId
            });
        }
        await db('integration_webhook_events')
            .where({ external_event_id: externalEventId })
            .update({
            processing_status: 'ignored',
            processing_error: reason,
            ...(shopId !== undefined ? { shop_id: shopId } : {}),
        });
    }
    static async markFailed(externalEventId, error, shopId) {
        if (shopId === undefined) {
            console.error('[WEBHOOK_LEDGER_SHOP_ID_MISSING_ON_UPDATE]', {
                externalEventId
            });
        }
        await db('integration_webhook_events')
            .where({ external_event_id: externalEventId })
            .update({
            processing_status: 'failed',
            processing_error: error,
            ...(shopId !== undefined ? { shop_id: shopId } : {}),
        });
    }
}
