// packages/api/src/sync.worker.ts
import { getQueueChannel } from './queue';
//import { Channel } from 'amqplib';
import db from './db';
import CryptoJS from 'crypto-js';
import { performInitialSync } from './services/shopify.service';

// --- Helper function for decryption ---
// (We'll need this to get the token to run the sync)
const decryptToken = (encryptedToken: string): string => {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error('ENCRYPTION_KEY is not set in environment.');
  }
  return CryptoJS.AES.decrypt(encryptedToken, secret).toString(CryptoJS.enc.Utf8);
};

const SYNC_QUEUE_NAME = 'sync_jobs';
const syncChannel = getQueueChannel(SYNC_QUEUE_NAME);

export async function processSyncJob(msg: { content: Buffer } | null) {
  if (msg === null) {
    return;
  }

  const content = msg.content.toString();
  try {
    const { integrationId } = JSON.parse(content);
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

    if (!integration) {
      console.error(`[sync.worker] Integration ${integrationId} not found.`);
      syncChannel.ack(msg as any);
      return;
    }

    // Decrypt the token
    const accessToken = decryptToken(integration.access_token_encrypted);

    // --- The sync logic ---
   if (integration.platform === 'shopify') {
        await performInitialSync(
          accessToken, 
          integration.platform_shop_name, 
          integration.shop_id
        );
   } else {
        console.warn(`[sync.worker] No sync logic implemented for platform: ${integration.platform}`);
      }
   console.log(`[sync.worker] Sync job COMPLETED for ${integrationId}`);
    syncChannel.ack(msg as any);

  } catch (error) {
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