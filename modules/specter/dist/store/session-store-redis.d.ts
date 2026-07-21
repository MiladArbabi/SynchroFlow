import { AnonymousSession, SessionStore } from './session-store.js';
/**
 * Redis-backed SessionStore.
 *
 * Design goals:
 * - Persist sessions to Redis (per-shop list); keep limited history with LTRIM.
 * - Maintain an in-memory snapshot Map<shopId, AnonymousSession[]> for synchronous reads
 *   required by computeSessionMetrics in tests.
 * - Expose init() and close() to control lifecycle (avoid import-time side-effects).
 *
 * Behavioural notes:
 * - If DISABLE_SESSION_REDIS or process.env.SPECTER_SESSION_STORE !== 'redis', you won't use this.
 * - When Redis is not connected, saveSession will attempt best-effort push (update memory snapshot).
 */
export declare class RedisSessionStore implements SessionStore {
    private client;
    private connected;
    private snapshot;
    private listMaxLen;
    private eventsSnapshot;
    private eventListMaxLen;
    private redisUrl;
    constructor(opts?: {
        redisUrl?: string;
        listMaxLen?: number;
    });
    /** Connect the redis client and load an initial snapshot for recent shops (best-effort). */
    init(): Promise<void>;
    /** Close redis client (used by jest global teardown / runtime shutdown). */
    close(): Promise<void>;
    /** Helper: redis key for shop list */
    private shopKey;
    /** Helper: redis key for shop event ledger */
    private eventsKey;
    /** Helper: redis key for shop config */
    private configKey;
    /** Persist a session and return the sessionId */
    saveSession(session: AnonymousSession): Promise<string>;
    /** Synchronous accessor used by computeSessionMetrics in tests */
    getAllSessionsForShop(shopId: number): AnonymousSession[];
    /** Async helper used by some tests: return sessions from last N days (by createdAt) */
    getSessionsLastNDays(shopId: number, days?: number): Promise<AnonymousSession[]>;
    /** Append an event to the shop's event list (newest-first via LPUSH). */
    appendEvent(shopId: number, event: any): Promise<void>;
    /** Read recent events (newest-first) from Redis or fallback to snapshot. */
    getRecentEvents(shopId: number, limit?: number): Promise<any[]>;
    /** Read shop config (returns parsed JSON or null) */
    getShopConfig(shopId: number): Promise<any | null>;
    /** Update/replace shop config in Redis and warm snapshot */
    updateShopConfig(shopId: number, patch: any): Promise<any>;
    /** Warm the in-memory cache for a shop (accepts full config object) */
    warmCache(shopId: number, config: any): Promise<void>;
    /** Utility to reset the store (helpful in tests)
     *
     * Notes:
     * - This starts a non-blocking, best-effort cleanup job and returns immediately.
     * - Deletion is done in small batches to avoid argument-count limits.
     * - Tries UNLINK, falls back to DEL, falls back to sending raw commands, and finally deletes one-by-one.
     */
    reset(): Promise<void>;
}
/** Export convenience init/close functions (runtime lifecycle hooks) */
export declare function initRedisSessionStore(store?: RedisSessionStore): Promise<RedisSessionStore>;
export declare function closeRedisSessionStore(store: RedisSessionStore): Promise<void>;
