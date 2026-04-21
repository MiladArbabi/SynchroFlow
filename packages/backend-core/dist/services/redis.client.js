// packages/backend-core/src/services/redis.client.ts
//
// SHARED REDIS CLIENT (WM-19 v2)
// --------------------------------
// Single Redis client instance for the backend.
// Currently used by: permission cache (WM-19 v2)
// Future uses: session cache, rate limiting, pub/sub
//
// Connection:
//   REDIS_URL env var (default: redis://localhost:6379)
//   Same instance as Docker redis service in docker-compose.yml
//
// Lifecycle:
//   initRedisClient() — called in bootstrap/express.ts or server.ts
//   closeRedisClient() — called in graceful shutdown
//
// Usage:
//   import { getRedisClient } from '@lasyncro/backend-core/services/redis.client.js';
//   const redis = getRedisClient();
//   await redis.set('key', 'value', { EX: 300 });
import { createClient } from 'redis';
let client = null;
/**
 * Initialize the shared Redis client.
 * Safe to call multiple times — only creates one connection.
 */
export async function initRedisClient() {
    if (client)
        return;
    const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
    client = createClient({ url: redisUrl });
    client.on('error', (err) => {
        console.error('[redis] Client error:', err.message);
    });
    client.on('reconnecting', () => {
        console.warn('[redis] Reconnecting...');
    });
    await client.connect();
    console.log('[redis] Connected:', redisUrl);
}
/**
 * Returns the shared Redis client.
 * Throws if client not initialized — call initRedisClient() in bootstrap first.
 */
export function getRedisClient() {
    if (!client) {
        throw new Error('[redis] Client not initialized. Call initRedisClient() first.');
    }
    return client;
}
/**
 * Close the Redis client gracefully.
 * Called during server shutdown.
 */
export async function closeRedisClient() {
    if (!client)
        return;
    try {
        await client.quit();
        console.log('[redis] Client closed');
    }
    catch (err) {
        console.warn('[redis] Error closing client:', err.message);
    }
    finally {
        client = null;
    }
}
