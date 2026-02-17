export type WebhookProcessingStatus = 'received' | 'ignored' | 'processed' | 'failed';
export declare class WebhookLedgerService {
    static recordReceived(params: {
        integration: string;
        externalEventId: string;
        eventType: string;
        payload: unknown;
        idempotencyKey: string;
    }): Promise<void>;
    static markProcessed(externalEventId: string, shopId?: number): Promise<void>;
    static markIgnored(externalEventId: string, reason: string, shopId?: number): Promise<void>;
    static markFailed(externalEventId: string, error: string, shopId?: number): Promise<void>;
}
