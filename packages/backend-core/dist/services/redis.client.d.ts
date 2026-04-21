import { RedisClientType } from 'redis';
/**
 * Initialize the shared Redis client.
 * Safe to call multiple times — only creates one connection.
 */
export declare function initRedisClient(): Promise<void>;
/**
 * Returns the shared Redis client.
 * Throws if client not initialized — call initRedisClient() in bootstrap first.
 */
export declare function getRedisClient(): RedisClientType;
/**
 * Close the Redis client gracefully.
 * Called during server shutdown.
 */
export declare function closeRedisClient(): Promise<void>;
