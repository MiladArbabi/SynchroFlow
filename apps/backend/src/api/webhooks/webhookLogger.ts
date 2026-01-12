// webhookLogger.ts
//
// Phase 8 – Operator observability
//

export function logWebhookEvent(params: {
  integration: string;
  eventId: string;
  eventType: string;
  status: 'received' | 'duplicate' | 'ignored' | 'processed' | 'failed';
  reason?: string;
  shopId?: number;
  shopDomain?: string;
}) {
  console.log({
    surface: 'webhook',
    integration: params.integration,
    event_id: params.eventId,
    event_type: params.eventType,
    status: params.status,
    reason: params.reason ?? null,
    shop_id: params.shopId ?? null,
    shop_domain: params.shopDomain ?? null,
  });
}