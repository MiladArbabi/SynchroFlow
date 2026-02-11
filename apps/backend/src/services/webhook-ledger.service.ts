import db from 'api-src/db';

export type WebhookProcessingStatus =
  | 'received'
  | 'ignored'
  | 'processed'
  | 'failed';

export class WebhookLedgerService {
  static async recordReceived(params: {
    integration: string;
    externalEventId: string;
    eventType: string;
    payload: unknown;
    idempotencyKey: string;
  }): Promise<void> {
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

  static async markProcessed(
    externalEventId: string,
    shopId?: number
  ): Promise<void> {
    await db('integration_webhook_events')
      .where({ external_event_id: externalEventId })
      .update({
        processing_status: 'processed',
        shop_id: shopId ?? null,
      });
  }

  static async markIgnored(
    externalEventId: string,
    reason: string,
    shopId?: number
  ): Promise<void> {
    await db('integration_webhook_events')
      .where({ external_event_id: externalEventId })
      .update({
        processing_status: 'ignored',
        processing_error: reason,
        shop_id: shopId ?? null,
      });
  }

  static async markFailed(
    externalEventId: string,
    error: string,
    shopId?: number
  ): Promise<void> {
    await db('integration_webhook_events')
      .where({ external_event_id: externalEventId })
      .update({
        processing_status: 'failed',
        processing_error: error,
        shop_id: shopId ?? null,
      });
  }
}