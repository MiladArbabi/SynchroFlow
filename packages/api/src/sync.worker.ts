// packages/api/src/sync.worker.ts (add integration validation)
import { getQueueChannel } from './queue';
import db from './db';
import CryptoJS from 'crypto-js';
import { performInitialSync } from './services/shopify.service';

// --- Helper function for decryption ---
const decryptToken = (encryptedToken: string): string => {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error('ENCRYPTION_KEY is not set in environment.');
  }
  return CryptoJS.AES.decrypt(encryptedToken, secret).toString(CryptoJS.enc.Utf8);
};

// --- Helper function to validate integration data ---
const validateIntegration = (integration: any): { 
  isValid: boolean; 
  error?: string;
  shouldAck?: boolean
} => {
  if (!integration) {
    return { isValid: false, error: 'Integration not found' };
  }
  
  const requiredFields = ['id', 'shop_id', 'platform', 'platform_shop_name', 'access_token_encrypted'];
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
const syncChannel = getQueueChannel(SYNC_QUEUE_NAME);

export async function processSyncJob(msg: { content: Buffer } | null) {
  if (msg === null) {
    return;
  }

  const content = msg.content.toString();
  let integrationId: number | undefined;

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

    // Fetch the integration to get the token
    const integration = await db('integrations')
      .where({ id: integrationId })
      .first<{ 
          id: number; 
          shop_id: number; 
          platform: string; 
          platform_shop_name: string;
          access_token_encrypted: string 
        }>();

    // Validate integration data
    const validation = validateIntegration(integration);
    if (!validation.isValid) {
      console.error(`[sync.worker] Invalid integration data: ${validation.error}`);
      
      // Update integration status to reflect the error
      await db('integrations').where({ id: integrationId }).update({
        sync_status: 'FAILED',
        sync_last_error: validation.error,
      });
      
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

    // Decrypt the token
    const accessToken = decryptToken(integration!.access_token_encrypted);

    // --- The sync logic ---
    if (integration!.platform === 'shopify') {
      await performInitialSync(
        accessToken, 
        integration!.platform_shop_name, 
        integration!.shop_id,
        integration!.id
      );
    } else {
      console.warn(`[sync.worker] No sync logic implemented for platform: ${integration!.platform}`);
    }
    console.log(`[sync.worker] Sync job COMPLETED for ${integrationId}`);
    syncChannel.ack(msg as any);

  } catch (error) {
    // --- START: Pizza Dropped Reporting ---
    if (integrationId) {
      await db('integrations').where({ id: integrationId }).update({
        sync_status: 'FAILED',
        sync_last_error: (error as Error).message || 'An unknown sync error occurred.',
      });
    }
    // --- END: Pizza Dropped Reporting ---

    console.error('[sync.worker] Error processing sync job:', error);
    syncChannel.nack(msg as any, false, false);
  }
}

// This function starts the consumer
export function startSyncWorker() {
  console.log('[sync.worker] Starting Sync worker...');
  syncChannel.consume(SYNC_QUEUE_NAME, processSyncJob, { noAck: false });
  console.log('[sync.worker] Sync worker started. Waiting for jobs...');
}