"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionStore = exports.InMemorySessionStore = void 0;
exports.createSessionStore = createSessionStore;
exports.recordShopSession = recordShopSession;
exports.getShopSession = getShopSession;
exports.appendEvent = appendEvent;
exports.getRecentEvents = getRecentEvents;
exports.getShopConfig = getShopConfig;
exports.updateShopConfig = updateShopConfig;
exports.warmCache = warmCache;
exports.setSessionStoreForTests = setSessionStoreForTests;
/** In-memory session store used for tests and simple dev setups.
 *  Provides saveSession and retrieval helpers expected by ingestion & tests.
 */
class InMemorySessionStore {
    constructor(initial) {
        this.sessions = [];
        // in-memory event ledger (new) — newest-first array per shopId
        this.events = new Map();
        this.eventListMaxLen = 50;
        // in-memory config cache (FT0) — simple per-shop object storage
        this.configs = new Map();
        if (Array.isArray(initial))
            this.sessions = initial.slice();
    }
    /** Persist a session and return the sessionId */
    async saveSession(session) {
        // keep a shallow copy (avoid external mutation)
        const copy = { ...session, pagesViewed: session.pagesViewed ? session.pagesViewed.slice() : [] };
        this.sessions.push(copy);
        return copy.sessionId;
    }
    /** Synchronous accessor used by computeSessionMetrics in tests */
    getAllSessionsForShop(shopId) {
        return this.sessions.filter(s => Number(s.shopId) === Number(shopId));
    }
    /** Async helper used by some tests: return sessions from last N days (by createdAt) */
    async getSessionsLastNDays(shopId, days = 7) {
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        return this.getAllSessionsForShop(shopId).filter(s => {
            const t = Date.parse(s.createdAt || '');
            return !Number.isNaN(t) && t >= cutoff;
        });
    }
    /* ------------------------
     * Event ledger (in-memory)
     * ------------------------ */
    async appendEvent(shopId, event) {
        const id = Number(shopId);
        const arr = this.events.get(id) || [];
        const ev = { timestamp: event.timestamp || Date.now(), ...event };
        // newest-first
        arr.unshift(ev);
        if (this.eventListMaxLen > 0 && arr.length > this.eventListMaxLen) {
            arr.length = this.eventListMaxLen;
        }
        this.events.set(id, arr);
    }
    async getRecentEvents(shopId, limit = 50) {
        const id = Number(shopId);
        const arr = this.events.get(id) || [];
        return arr.slice(0, limit);
    }
    /* ------------------------
     * Config cache (in-memory)
     * ------------------------ */
    /** Read shop config (may return null if absent) */
    async getShopConfig(shopId) {
        const id = Number(shopId);
        return this.configs.has(id) ? this.configs.get(id) : null;
    }
    /** Update/patch shop config. If patch is not an object, replace. Returns the new config. */
    async updateShopConfig(shopId, patch) {
        const id = Number(shopId);
        const existing = this.configs.get(id) ?? null;
        let updated;
        if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
            // replace entirely
            updated = patch;
        }
        else if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
            // replace with a non-object
            updated = patch;
        }
        else {
            // shallow merge patch into existing
            updated = { ...existing, ...patch };
        }
        this.configs.set(id, updated);
        return updated;
    }
    /** Warm the in-memory cache for a shop (accepts full config object) */
    async warmCache(shopId, config) {
        const id = Number(shopId);
        if (config === null || typeof config === 'undefined') {
            this.configs.delete(id);
        }
        else {
            this.configs.set(id, config);
        }
    }
    /** Utility to reset the store (helpful in tests) */
    reset() {
        this.sessions = [];
        this.events.clear();
        this.configs.clear();
    }
    /** Backwards-compatible helper name used by tests/helpers */
    clearAll() {
        // delegate to reset() so behavior stays in one place
        this.reset();
    }
}
exports.InMemorySessionStore = InMemorySessionStore;
;
// ----------------------------
// Production factory & test override
// ----------------------------
let _overriddenStore = null;
/**
 * Create a production store instance based on environment.
 * Supported values: 'memory' (default), 'redis' (if redis package available)
 */
function createSessionStore() {
    if (_overriddenStore)
        return _overriddenStore;
    // Force in-memory in tests for deterministic, synchronous behavior.
    // Jest sets NODE_ENV=test by default; ensure we never pick Redis for unit tests.
    if (process.env.NODE_ENV === 'test') {
        return new InMemorySessionStore();
    }
    const backend = (process.env.SPECTER_SESSION_STORE || 'memory').toLowerCase();
    if (backend === 'redis') {
        // lazy require redis-backed implementation — keep it optional for dev/test
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const redisModule = require('./session-store-redis');
            if (redisModule && typeof redisModule.RedisSessionStore === 'function') {
                return new redisModule.RedisSessionStore();
            }
        }
        catch (e) {
            // if redis not installed or fails, fallback to memory
            // eslint-disable-next-line no-console
            console.warn('Redis session store unavailable, falling back to InMemorySessionStore:', e?.message ?? String(e));
        }
    }
    return new InMemorySessionStore();
}
/** Convenience: current singleton store used by ingestion code */
exports.sessionStore = createSessionStore();
/** Top-level FT0 helpers (lightweight wrappers around the store) */
/**
 * recordShopSession(shopId, data)
 * Thin wrapper to keep existing saveSession semantics but provide stable FT0 name.
 */
async function recordShopSession(shopId, data) {
    const s = { ...data, shopId: Number(shopId) };
    if (!s.sessionId)
        s.sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // delegate to runtime store
    // @ts-ignore
    if (typeof exports.sessionStore.saveSession === 'function') {
        // @ts-ignore
        return await exports.sessionStore.saveSession(s);
    }
    return Promise.resolve(s.sessionId);
}
/** getShopSession(shopId) — return the most recent session or null */
async function getShopSession(shopId) {
    const sessions = exports.sessionStore.getAllSessionsForShop(Number(shopId)) || [];
    if (sessions.length === 0)
        return null;
    return sessions[sessions.length - 1] || null;
}
/** appendEvent(shopId, event) — delegate to store if supported */
async function appendEvent(shopId, event) {
    // @ts-ignore
    if (typeof exports.sessionStore.appendEvent === 'function') {
        // @ts-ignore
        return await exports.sessionStore.appendEvent(Number(shopId), event);
    }
    return Promise.resolve();
}
/** getRecentEvents(shopId, limit) — delegate to store if supported */
async function getRecentEvents(shopId, limit = 50) {
    // @ts-ignore
    if (typeof exports.sessionStore.getRecentEvents === 'function') {
        // @ts-ignore
        return await exports.sessionStore.getRecentEvents(Number(shopId), limit);
    }
    return [];
}
/** getShopConfig(shopId) — delegate to store if supported */
async function getShopConfig(shopId) {
    // @ts-ignore
    if (typeof exports.sessionStore.getShopConfig === 'function') {
        // @ts-ignore
        return await exports.sessionStore.getShopConfig(Number(shopId));
    }
    return null;
}
/** updateShopConfig(shopId, patch) — delegate to store if supported */
async function updateShopConfig(shopId, patch) {
    // @ts-ignore
    if (typeof exports.sessionStore.updateShopConfig === 'function') {
        // @ts-ignore
        return await exports.sessionStore.updateShopConfig(Number(shopId), patch);
    }
    return null;
}
/** warmCache(shopId, config) — delegate to store if supported */
async function warmCache(shopId, config) {
    // @ts-ignore
    if (typeof exports.sessionStore.warmCache === 'function') {
        // @ts-ignore
        return await exports.sessionStore.warmCache(Number(shopId), config);
    }
    return Promise.resolve();
}
/** Test helper: override the runtime store (useful in tests) */
function setSessionStoreForTests(store) {
    _overriddenStore = store;
}
if (typeof module !== 'undefined' && module.exports) {
    // preserve existing module.exports shape while ensuring default & named props exist
    try {
        module.exports = {
            default: exports.sessionStore,
            InMemorySessionStore,
            // also export interface-friendly named bindings for CJS consumers
            sessionStore: exports.sessionStore,
            createSessionStore,
            setSessionStoreForTests,
            // FT0 helpers
            recordShopSession,
            getShopSession,
            appendEvent,
            getRecentEvents,
            // FT0 config helpers
            getShopConfig,
            updateShopConfig,
            warmCache
        };
    }
    catch (e) {
        // defensive: do nothing if environment prevents assignment
    }
}
//# sourceMappingURL=session-store.js.map