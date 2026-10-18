// apps/backend/src/sync.worker.ts (add integration validation)
import { getQueueChannel } from './queue.js';
import db, { systemQuery, withTenant } from '@lasyncro/backend-core/db.js';
import { resolveShopifyAdminCredentialForConsumer } from './services/shopify/shopifyAdminCredentialConsumer.service.js';
import { performSmartSync } from './services/shopify-sync-orchestrator.service.js';
import {
  claimShopifySyncCycle,
  updateIntegrationStatus,
  type ShopifySyncExecutionAuthority,
} from './services/shopify/shopifyIntegrationStatus.service.js';

// --- Helper function to validate integration data ---
const validateIntegration = (integration: any): { 
  isValid: boolean; 
  error?: string;
  shouldAck?: boolean
} => {
  if (!integration) {
    return { isValid: false, error: 'Integration not found' };
  }
  
  const requiredFields = ['id', 'shop_id', 'platform', 'platform_shop_name'];
  const missingFields = requiredFields.filter(field => !integration[field]);
  
  if (missingFields.length > 0) {
    return { 
      isValid: false, 
      error: `Integration missing required fields: ${missingFields.join(', ')}` 
    };
  }
  
  if (integration.platform !== 'shopify') {
    return { 
      isValid: true, // Mark as valid but unsupported
      error: `Unsupported platform: ${integration.platform}`,
      shouldAck: true
    };
  }
  
  return { isValid: true };
};

const staleSyncError = (error: unknown): boolean =>
  error instanceof Error &&
  error.message === 'SHOPIFY_SYNC_STALE_AUTHORITY';

const isPositiveId = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;

const SYNC_QUEUE_NAME = 'sync_jobs';
let syncChannel: ReturnType<typeof getQueueChannel>;
let syncConsumerTag: string | null = null;
let syncAttachmentPromise: Promise<void> | null = null;
let syncStopPromise: Promise<void> | null = null;
let acceptingSyncDeliveries = false;
const activeSyncDeliveries = new Set<Promise<void>>();
let syncDeliveryFailures: unknown[] = [];

export async function processSyncJob(msg: { content: Buffer } | null) {
  if (msg === null) {
    return;
  }

  const content = msg.content.toString();
  let integrationId: number | undefined;
  let shopId: number | undefined;

  try {
    // Parse JSON first and handle parsing errors
    let parsedContent: any;
    try {
      parsedContent = JSON.parse(content);
    } catch (parseError) {
      console.error('[sync.worker] Invalid JSON in message:', parseError);
      syncChannel.nack(msg as any, false, false);
      return;
    }

    integrationId = parsedContent.integrationId;
    if (!integrationId) {
      console.error('[sync.worker] Message is missing integrationId');
      syncChannel.ack(msg as any);
      return;
    }

    // GH-1068 T3-B: only an exact durable intent may start a cycle. Without
    // one, nothing is resolved or written; the intent itself stays in the outbox.
    const intentDomainEventId = parsedContent.intentDomainEventId;
    if (!isPositiveId(integrationId) || !isPositiveId(intentDomainEventId)) {
      console.warn('[sync.worker] Message lacks an exact sync intent identity');
      syncChannel.ack(msg as any);
      return;
    }

    console.log(`[sync.worker] Received sync job for integration ID: ${integrationId}`);

    // Resolve only the tenant identifier before opening a tenant-scoped read.
    const tenantLookup = await systemQuery(
      db.raw('SELECT shop_id FROM public.resolve_integration_tenant(?)', [
        integrationId,
      ])
    );
    shopId = tenantLookup.rows?.[0]?.shop_id;

    const integration = shopId
      ? await withTenant(shopId, (trx) =>
          trx('integrations')
            .where({ id: integrationId, shop_id: shopId })
            .select('id', 'shop_id', 'platform', 'platform_shop_name')
            .first<{
              id: number;
              shop_id: number;
              platform: string;
              platform_shop_name: string;
            }>()
        )
      : undefined;

    // Validate integration data
    const validation = validateIntegration(integration);
    if (!validation.isValid) {
      console.error(`[sync.worker] Invalid integration data: ${validation.error}`);
      
      // No authenticated installation authority: do not mutate status.
      
      syncChannel.nack(msg as any, false, false);
      return;
    }

    // Handle unsupported platforms (valid but not Shopify)
    if (validation.shouldAck) {
      console.warn(`[sync.worker] No sync logic implemented for platform: ${integration!.platform}`);
      console.log(`[sync.worker] Acking message for unsupported platform: ${integration!.platform}`);
      syncChannel.ack(msg as any);
      return;
    }

    // The operational read has committed before credential resolution.
    const credential = await resolveShopifyAdminCredentialForConsumer({
      shopId: integration!.shop_id,
      now: new Date(),
    });
    if (credential.kind !== 'READY') {
      const code = `SHOPIFY_CREDENTIAL_${credential.kind}`;
      console.warn('[sync.worker] Credential authority unavailable:', code);
      syncChannel.nack(msg as any, false, false);
      return;
    }

    const executionAuthority: ShopifySyncExecutionAuthority = {
      installationId: credential.installationId,
      shopDomain: credential.shopDomain,
      generation: credential.generation,
    };

    if (
      !Number.isSafeInteger(executionAuthority.installationId) ||
      executionAuthority.installationId <= 0 ||
      typeof executionAuthority.generation !== 'string' ||
      executionAuthority.generation.length === 0 ||
      executionAuthority.shopDomain !== integration!.platform_shop_name
    ) {
      console.error('[sync.worker] Missing or mismatched sync authority');
      syncChannel.nack(msg as any, false, false);
      return;
    }

    // Single-flight: atomically claim PENDING for the current intent, or write nothing.
    let cycle;
    try {
      cycle = await claimShopifySyncCycle({
        integrationId: integration!.id,
        shopId: integration!.shop_id,
        intentDomainEventId,
        executionAuthority,
      });
    } catch (error) {
      if (staleSyncError(error)) {
        console.warn('[sync.worker] Sync intent claim rejected by generation fence');
        syncChannel.ack(msg as any);
        return;
      }
      throw error;
    }
    if (cycle.kind !== 'CLAIMED') {
      console.warn('[sync.worker] Sync intent not eligible to start a cycle:', cycle.reason);
      syncChannel.ack(msg as any);
      return;
    }

    try {
      await performSmartSync(
        credential.accessToken,
        credential.shopDomain,
        integration!.shop_id,
        integration!.id,
        executionAuthority
      );
    } catch (error) {
      if (staleSyncError(error)) {
        console.warn('[sync.worker] Stale sync job discarded');
        syncChannel.ack(msg as any);
        return;
      }

      try {
        await updateIntegrationStatus({
          integrationId: integration!.id,
          shopId: integration!.shop_id,
          status: 'FAILED',
          error: error instanceof Error ? error.message : String(error),
          executionAuthority,
        });
      } catch (writeError) {
        if (staleSyncError(writeError)) {
          console.warn('[sync.worker] Failure write rejected by generation fence');
          syncChannel.ack(msg as any);
          return;
        }
        console.error('[sync.worker] Fenced failure write failed:', writeError);
      }

      throw error;
    }

    console.log(`[sync.worker] Sync job COMPLETED for ${integrationId}`);

    syncChannel.ack(msg as any);

  } catch (error) {
    // Failure persistence is exclusively generation-fenced above.
    // Preserve the B4 delivery failure/ACK/NACK ownership contract.
    console.error('[sync.worker] Error processing sync job:', error);
    syncChannel.nack(msg as any, false, false);
  }
}

// This function starts the consumer
function ownSyncDelivery(msg: { content: Buffer } | null): Promise<void> {
  if (!acceptingSyncDeliveries) return Promise.resolve();

  let owned!: Promise<void>;
  owned = processSyncJob(msg)
    .catch((error) => {
      syncDeliveryFailures.push(error);
      throw error;
    })
    .finally(() => {
      activeSyncDeliveries.delete(owned);
    });
  activeSyncDeliveries.add(owned);
  return owned;
}

function handleSyncDelivery(msg: { content: Buffer } | null): void {
  void ownSyncDelivery(msg).catch(() => undefined);
}

export function startSyncWorker(): Promise<void> {
  if (syncStopPromise) return syncStopPromise.then(() => startSyncWorker());
  if (syncAttachmentPromise) return syncAttachmentPromise;
  if (acceptingSyncDeliveries && syncConsumerTag) return Promise.resolve();

  console.log('[sync.worker] Starting Sync worker...');

  syncChannel = getQueueChannel(SYNC_QUEUE_NAME);
  acceptingSyncDeliveries = true;
  syncDeliveryFailures = [];

  const attachment = Promise.resolve(
    syncChannel.consume(SYNC_QUEUE_NAME, handleSyncDelivery, { noAck: false })
  ).then(async (reply) => {
    const consumerTag = reply?.consumerTag;
    if (!consumerTag) {
      throw new Error('[sync.worker] consume() returned no consumerTag');
    }
    if (!acceptingSyncDeliveries) {
      await syncChannel.cancel(consumerTag);
      return;
    }
    syncConsumerTag = consumerTag;
  });

  let ownedAttachment!: Promise<void>;
  ownedAttachment = attachment.finally(() => {
    if (syncAttachmentPromise === ownedAttachment) syncAttachmentPromise = null;
  });
  syncAttachmentPromise = ownedAttachment;

  console.log('[sync.worker] Sync worker started. Waiting for jobs...');
  return ownedAttachment;
}

export function stopSyncWorker(): Promise<void> {
  if (syncStopPromise) return syncStopPromise;

  acceptingSyncDeliveries = false;
  const operation = (async () => {
    const failures: unknown[] = [];
    const attachment = syncAttachmentPromise;
    if (attachment) {
      try { await attachment; } catch (error) { failures.push(error); }
    }

    const consumerTag = syncConsumerTag;
    syncConsumerTag = null;
    if (consumerTag) {
      try { await syncChannel.cancel(consumerTag); } catch (error) { failures.push(error); }
    }

    const deliveryResults = await Promise.allSettled(Array.from(activeSyncDeliveries));
    for (const result of deliveryResults) {
      if (result.status === 'rejected') failures.push(result.reason);
    }
    failures.push(...syncDeliveryFailures);
    syncDeliveryFailures = [];
    if (failures.length > 0) throw failures[0];
  })();

  let ownedStop!: Promise<void>;
  ownedStop = operation.finally(() => {
    if (syncStopPromise === ownedStop) syncStopPromise = null;
  });
  syncStopPromise = ownedStop;
  return ownedStop;
}
