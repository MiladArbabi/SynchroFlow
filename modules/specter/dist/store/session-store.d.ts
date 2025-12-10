export interface AnonymousSession {
    sessionId: string;
    shopId: number;
    landingPage?: string;
    pagesViewed?: string[];
    exitIntent: boolean;
    createdAt: string;
    [k: string]: any;
}
/** Event payload stored in the Specter event ledger */
export interface SpecterEvent {
    type: string;
    timestamp?: number;
    payload?: Record<string, any>;
    [k: string]: any;
}
/** SessionStore interface (explicit) */
export interface SessionStore {
    saveSession(session: AnonymousSession): Promise<string>;
    getAllSessionsForShop(shopId: number): AnonymousSession[];
    getSessionsLastNDays(shopId: number, days?: number): Promise<AnonymousSession[]>;
    reset(): void;
    appendEvent?(shopId: number, event: SpecterEvent): Promise<void> | void;
    getRecentEvents?(shopId: number, limit?: number): Promise<SpecterEvent[]>;
}
/** In-memory session store used for tests and simple dev setups.
 *  Provides saveSession and retrieval helpers expected by ingestion & tests.
 */
export declare class InMemorySessionStore implements SessionStore {
    private sessions;
    private events;
    private eventListMaxLen;
    private configs;
    constructor(initial?: AnonymousSession[]);
    /** Persist a session and return the sessionId */
    saveSession(session: AnonymousSession): Promise<string>;
    /** Synchronous accessor used by computeSessionMetrics in tests */
    getAllSessionsForShop(shopId: number): AnonymousSession[];
    /** Async helper used by some tests: return sessions from last N days (by createdAt) */
    getSessionsLastNDays(shopId: number, days?: number): Promise<AnonymousSession[]>;
    appendEvent(shopId: number, event: SpecterEvent): Promise<void>;
    getRecentEvents(shopId: number, limit?: number): Promise<SpecterEvent[]>;
    /** Read shop config (may return null if absent) */
    getShopConfig(shopId: number): Promise<any | null>;
    /** Update/patch shop config. If patch is not an object, replace. Returns the new config. */
    updateShopConfig(shopId: number, patch: any): Promise<any>;
    /** Warm the in-memory cache for a shop (accepts full config object) */
    warmCache(shopId: number, config: any): Promise<void>;
    /** Utility to reset the store (helpful in tests) */
    reset(): void;
    /** Backwards-compatible helper name used by tests/helpers */
    clearAll(): void;
}
/**
 * Create a production store instance based on environment.
 * Supported values: 'memory' (default), 'redis' (if redis package available)
 */
export declare function createSessionStore(): SessionStore;
/** Convenience: current singleton store used by ingestion code */
export declare const sessionStore: SessionStore;
/** Top-level FT0 helpers (lightweight wrappers around the store) */
/**
 * recordShopSession(shopId, data)
 * Thin wrapper to keep existing saveSession semantics but provide stable FT0 name.
 */
export declare function recordShopSession(shopId: number, data: AnonymousSession): Promise<string>;
/** getShopSession(shopId) — return the most recent session or null */
export declare function getShopSession(shopId: number): Promise<AnonymousSession | null>;
/** appendEvent(shopId, event) — delegate to store if supported */
export declare function appendEvent(shopId: number, event: SpecterEvent): Promise<void>;
/** getRecentEvents(shopId, limit) — delegate to store if supported */
export declare function getRecentEvents(shopId: number, limit?: number): Promise<SpecterEvent[]>;
/** getShopConfig(shopId) — delegate to store if supported */
export declare function getShopConfig(shopId: number): Promise<any | null>;
/** updateShopConfig(shopId, patch) — delegate to store if supported */
export declare function updateShopConfig(shopId: number, patch: any): Promise<any | null>;
/** warmCache(shopId, config) — delegate to store if supported */
export declare function warmCache(shopId: number, config: any): Promise<void>;
/** Test helper: override the runtime store (useful in tests) */
export declare function setSessionStoreForTests(store: SessionStore | null): void;
