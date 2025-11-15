"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processSyncJob = processSyncJob;
exports.startSyncWorker = startSyncWorker;
// packages/api/src/sync.worker.ts (add integration validation)
const queue_1 = require("./queue");
const db_1 = __importDefault(require("./db"));
const crypto_js_1 = __importDefault(require("crypto-js"));
const shopify_service_1 = require("./services/shopify.service");
// --- Helper function for decryption ---
const decryptToken = (encryptedToken) => {
    const secret = process.env.ENCRYPTION_KEY;
    if (!secret) {
        throw new Error('ENCRYPTION_KEY is not set in environment.');
    }
    return crypto_js_1.default.AES.decrypt(encryptedToken, secret).toString(crypto_js_1.default.enc.Utf8);
};
// --- Helper function to validate integration data ---
const validateIntegration = (integration) => {
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
const syncChannel = (0, queue_1.getQueueChannel)(SYNC_QUEUE_NAME);
async function processSyncJob(msg) {
    if (msg === null) {
        return;
    }
    const content = msg.content.toString();
    let integrationId;
    try {
        // Parse JSON first and handle parsing errors
        let parsedContent;
        try {
            parsedContent = JSON.parse(content);
        }
        catch (parseError) {
            console.error('[sync.worker] Invalid JSON in message:', parseError);
            syncChannel.nack(msg, false, false);
            return;
        }
        integrationId = parsedContent.integrationId;
        if (!integrationId) {
            console.error('[sync.worker] Message is missing integrationId');
            syncChannel.ack(msg);
            return;
        }
        console.log(`[sync.worker] Received sync job for integration ID: ${integrationId}`);
        // Fetch the integration to get the token
        const integration = await (0, db_1.default)('integrations')
            .where({ id: integrationId })
            .first();
        // Validate integration data
        const validation = validateIntegration(integration);
        if (!validation.isValid) {
            console.error(`[sync.worker] Invalid integration data: ${validation.error}`);
            // Update integration status to reflect the error
            await (0, db_1.default)('integrations').where({ id: integrationId }).update({
                sync_status: 'FAILED',
                sync_last_error: validation.error,
            });
            syncChannel.nack(msg, false, false);
            return;
        }
        // Handle unsupported platforms (valid but not Shopify)
        if (validation.shouldAck) {
            console.warn(`[sync.worker] No sync logic implemented for platform: ${integration.platform}`);
            console.log(`[sync.worker] Acking message for unsupported platform: ${integration.platform}`);
            syncChannel.ack(msg);
            return;
        }
        // Decrypt the token
        const accessToken = decryptToken(integration.access_token_encrypted);
        // --- The sync logic ---
        if (integration.platform === 'shopify') {
            await (0, shopify_service_1.performInitialSync)(accessToken, integration.platform_shop_name, integration.shop_id, integration.id);
        }
        else {
            console.warn(`[sync.worker] No sync logic implemented for platform: ${integration.platform}`);
        }
        console.log(`[sync.worker] Sync job COMPLETED for ${integrationId}`);
        syncChannel.ack(msg);
    }
    catch (error) {
        // --- START: Pizza Dropped Reporting ---
        if (integrationId) {
            await (0, db_1.default)('integrations').where({ id: integrationId }).update({
                sync_status: 'FAILED',
                sync_last_error: error.message || 'An unknown sync error occurred.',
            });
        }
        // --- END: Pizza Dropped Reporting ---
        console.error('[sync.worker] Error processing sync job:', error);
        syncChannel.nack(msg, false, false);
    }
}
// This function starts the consumer
function startSyncWorker() {
    console.log('[sync.worker] Starting Sync worker...');
    syncChannel.consume(SYNC_QUEUE_NAME, processSyncJob, { noAck: false });
    console.log('[sync.worker] Sync worker started. Waiting for jobs...');
}
