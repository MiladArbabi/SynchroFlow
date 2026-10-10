// apps/backend/src/sync.worker.ts (add integration validation)
import { getQueueChannel } from './queue.js';
import db, { systemQuery, withTenant } from '@lasyncro/backend-core/db.js';
import { resolveShopifyAdminCredentialForConsumer } from './services/shopify/shopifyAdminCredentialConsumer.service.js';
import { performSmartSync } from './services/shopify-sync-orchestrator.service.js';

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

const SYNC_QUEUE_NAME = 'sync_jobs';
let syncChannel: ReturnType<typeof getQueueChannel>;

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
      
      // Update integration status to reflect the error
      if (shopId) {
        await withTenant(shopId, (trx) =>
          trx('integrations').where({ id: integrationId, shop_id: shopId }).update({
            sync_status: 'FAILED',
            sync_last_error: validation.error,
          })
        );
      }
      
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
      await withTenant(integration!.shop_id, (trx) =>
        trx('integrations').where({ id: integration!.id, shop_id: integration!.shop_id }).update({
          sync_status: 'FAILED',
          sync_last_error: code,
        })
      );
      syncChannel.nack(msg as any, false, false);
      return;
    }

    await performSmartSync(
      credential.accessToken,
      credential.shopDomain,
      integration!.shop_id,
      integration!.id
    );

    console.log(`[sync.worker] Sync job COMPLETED for ${integrationId}`);

    syncChannel.ack(msg as any);

  } catch (error) {
    // --- START: Pizza Dropped Reporting ---
    if (integrationId && shopId) {
      await withTenant(shopId, (trx) =>
        trx('integrations').where({ id: integrationId, shop_id: shopId }).update({
          sync_status: 'FAILED',
          sync_last_error: (error as Error).message || 'An unknown sync error occurred.',
        })
      );
    }
    // --- END: Pizza Dropped Reporting ---

    console.error('[sync.worker] Error processing sync job:', error);
    syncChannel.nack(msg as any, false, false);
  }
}

// This function starts the consumer
export function startSyncWorker() {
  console.log('[sync.worker] Starting Sync worker...');

  syncChannel = getQueueChannel(SYNC_QUEUE_NAME);

  syncChannel.consume(SYNC_QUEUE_NAME, processSyncJob, { noAck: false });

  console.log('[sync.worker] Sync worker started. Waiting for jobs...');
}
