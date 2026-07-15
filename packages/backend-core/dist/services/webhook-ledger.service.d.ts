import type { Knex } from 'knex';
export type WebhookProcessingStatus = 'received' | 'ignored' | 'processed' | 'failed';
export declare class WebhookLedgerService {
    static recordReceived(params: {
        shopId?: number | null;
        integration: string;
        externalEventId: string;
        eventType: string;
        payload: unknown;
        idempotencyKey: string;
    }, trx?: Knex | Knex.Transaction): Promise<boolean>;
    static markProcessed(externalEventId: string, shopId?: number, trx?: Knex | Knex.Transaction): Promise<void>;
    static markIgnored(externalEventId: string, reason: string, shopId?: number, trx?: Knex | Knex.Transaction): Promise<void>;
    static markFailed(externalEventId: string, error: string, shopId?: number, trx?: Knex | Knex.Transaction): Promise<void>;
}
