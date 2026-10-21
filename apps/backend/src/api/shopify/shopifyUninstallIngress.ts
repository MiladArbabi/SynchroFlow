import knex from 'knex';
import dbConfig from '@lasyncro/backend-core/config/database.config.js';
import { WebhookLedgerService } from '@lasyncro/backend-core/services/webhook-ledger.service.js';
import type { WebhookEnvelope } from '../webhooks/types.js';
import { onShopifyAppUninstalled } from './handlers/appUninstalled.handler.js';

const ACQUIRE_TIMEOUT_MS = 750;
const STATEMENT_TIMEOUT_MS = 2_500;
const LOCK_TIMEOUT_MS = 250;
const SLOW_REQUEST_MS = 4_000;

type IngressMetrics = { attempts: number; failures: number; timeouts: number; slow: number };
const metrics: IngressMetrics = { attempts: 0, failures: 0, timeouts: 0, slow: 0 };

/** Shopify app/uninstalled-only durable ingress. It never performs provider I/O. */
export async function dispatchShopifyUninstallIngress(envelope: WebhookEnvelope): Promise<void> {
  if (!envelope.verified || !envelope.shopDomain) throw new Error('SHOPIFY_UNINSTALL_VERIFIED_IDENTITY_REQUIRED');
  const shopDomain = envelope.shopDomain;
  const startedAt = Date.now();
  metrics.attempts += 1;
  const isolated = knex({
    ...dbConfig,
    pool: { min: 0, max: 1, acquireTimeoutMillis: ACQUIRE_TIMEOUT_MS, idleTimeoutMillis: 1_000 },
  });
  let acquiredAt = startedAt;
  let dbStartedAt = startedAt;
  try {
    // The probe measures acquisition independently. This pool is request-local
    // and max=1, so the following transaction reuses the same connection.
    await isolated.raw('SELECT 1');
    acquiredAt = Date.now();
    dbStartedAt = acquiredAt;
    await isolated.transaction(async trx => {
      await trx.raw(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`);
      await trx.raw(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
      const lookup = await trx.raw('SELECT shop_id FROM public.resolve_shopify_reinstall_shop(?)',
        [shopDomain]);
      const shopId = Number(lookup.rows?.[0]?.shop_id);
      if (!Number.isSafeInteger(shopId) || shopId <= 0) throw new Error('SHOPIFY_UNINSTALL_SHOP_NOT_FOUND');
      envelope.shopId = shopId;
      await trx.raw("SELECT set_config('app.current_tenant', ?, true)", [String(shopId)]);
      const claimed = await WebhookLedgerService.recordReceived({
        shopId, integration: 'shopify', externalEventId: envelope.eventId,
        eventType: 'app/uninstalled', payload: envelope.rawPayload,
        idempotencyKey: `shopify:${envelope.eventId}`,
      }, trx);
      if (claimed) await onShopifyAppUninstalled(envelope, trx);
    });
  } catch (error) {
    metrics.failures += 1;
    const message = error instanceof Error ? error.message : 'unknown';
    if (/timeout|timed out/i.test(message)) metrics.timeouts += 1;
    console.error('[SHOPIFY_UNINSTALL_INGRESS_FAILED]', { message, metrics: { ...metrics } });
    // No success is reported unless Knex observed COMMIT completion. A same-ID
    // Shopify retry is safe through the canonical ledger uniqueness contract.
    throw error;
  } finally {
    await isolated.destroy().catch(() => undefined);
    const completedAt = Date.now();
    const totalMs = completedAt - startedAt;
    if (totalMs >= SLOW_REQUEST_MS) metrics.slow += 1;
    console.info('[SHOPIFY_UNINSTALL_INGRESS_DURATION]', {
      eventId: envelope.eventId,
      acquisitionMs: acquiredAt - startedAt,
      databaseMs: completedAt - dbStartedAt,
      totalMs,
      slow: totalMs >= SLOW_REQUEST_MS,
      metrics: { ...metrics },
    });
  }
}
