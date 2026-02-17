import db from '@lasyncro/backend-core/db.js';
export class WebhookLedgerService {
    static async recordReceived(params) {
        await db('integration_webhook_events').insert({
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
