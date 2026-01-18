// modules/specter/src/store/session-store.ts
export interface AnonymousSession {
  sessionId: string;
  shopId: number;

  /**
   * Entry surface for the session (optional).
   */
  landingPage?: string;

  /**
   * Legacy / optional raw pages list (if provided by ingestion).
   * Not relied upon by FT2.
   */
  pagesViewed?: string[];

    /**
   * FT2-safe behavioral depth fact.
   * Represents the total number of pages/views observed in this session.
   *
   * Rules:
   * - Provided by ingestion layer
   * - No arrays, no paths, no timestamps
   * - Used for existence-only FT2 signals
   */
  pageViewsCount?: number;

  /**
   * FT2-safe surface breadth fact.
   * Number of unique surfaces/pages touched in this session.
   *
   * Rules:
   * - Count only (no paths)
   * - Provided by ingestion layer
   * - Used for existence-only breadth signals
   */
  uniquePathsCount?: number;

  /**
   * FT2-safe returning session flag.
   *
   * Rules:
   * - true  → returning visitor/session
   * - false → first-time visitor/session
   * - Provided by ingestion layer
   * - No identity exposed
   */
  isReturningSession?: boolean;

  /**
   * Exit intent flag (existence-only).
   */
  exitIntent: boolean;

  /**
   * Session creation timestamp (ISO string).
   */
  createdAt: string;

  /**
   * Allow forward-compatible ingestion without breaking storage.
   */
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
  /* --- sessions --- */
  saveSession(session: AnonymousSession): Promise<string>;
  getAllSessionsForShop(shopId: number): AnonymousSession[];
  getSessionsLastNDays(shopId: number, days?: number): Promise<AnonymousSession[]>;
  reset(): void;

  /* --- event ledger (optional) --- */
  appendEvent?(shopId: number, event: SpecterEvent): Promise<void> | void;
  getRecentEvents?(shopId: number, limit?: number): Promise<SpecterEvent[]>;
}

/** In-memory session store used for tests and simple dev setups.
 *  Provides saveSession and retrieval helpers expected by ingestion & tests.
 */
export class InMemorySessionStore implements SessionStore {
  private sessions: AnonymousSession[] = [];
  // in-memory event ledger (new) — newest-first array per shopId
  private events: Map<number, SpecterEvent[]> = new Map();
  private eventListMaxLen = 50;

  // in-memory config cache (FT0) — simple per-shop object storage
  private configs: Map<number, any> = new Map();

  constructor(initial?: AnonymousSession[]) {
    if (Array.isArray(initial)) this.sessions = initial.slice();
  }

  /** Persist a session and return the sessionId */
  async saveSession(session: AnonymousSession): Promise<string> {
    // keep a shallow copy (avoid external mutation)
    const copy = { ...session, pagesViewed: session.pagesViewed ? session.pagesViewed.slice() : [] };
    this.sessions.push(copy);
    return copy.sessionId;
  }

  /** Synchronous accessor used by computeSessionMetrics in tests */
  getAllSessionsForShop(shopId: number): AnonymousSession[] {
    return this.sessions.filter(s => Number(s.shopId) === Number(shopId));
  }

  /** Async helper used by some tests: return sessions from last N days (by createdAt) */
  async getSessionsLastNDays(shopId: number, days = 7): Promise<AnonymousSession[]> {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return this.getAllSessionsForShop(shopId).filter(s => {
      const t = Date.parse(s.createdAt || '');
      return !Number.isNaN(t) && t >= cutoff;
    });
  }

  /* ------------------------
   * Event ledger (in-memory)
   * ------------------------ */

  async appendEvent(shopId: number, event: SpecterEvent): Promise<void> {
    const id = Number(shopId);
    const arr = this.events.get(id) || [];
    const ev: SpecterEvent = { timestamp: event.timestamp || Date.now(), ...event };
    // newest-first
    arr.unshift(ev);
    if (this.eventListMaxLen > 0 && arr.length > this.eventListMaxLen) {
      arr.length = this.eventListMaxLen;
    }
    this.events.set(id, arr);
  }

  async getRecentEvents(shopId: number, limit = 50): Promise<SpecterEvent[]> {
    const id = Number(shopId);
    const arr = this.events.get(id) || [];
    return arr.slice(0, limit);
  }

  /* ------------------------
   * Config cache (in-memory)
   * ------------------------ */

  /** Read shop config (may return null if absent) */
  async getShopConfig(shopId: number): Promise<any | null> {
    const id = Number(shopId);
    return this.configs.has(id) ? this.configs.get(id) : null;
  }

  /** Update/patch shop config. If patch is not an object, replace. Returns the new config. */
  async updateShopConfig(shopId: number, patch: any): Promise<any> {
    const id = Number(shopId);
    const existing = this.configs.get(id) ?? null;
    let updated: any;
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      // replace entirely
      updated = patch;
    } else if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      // replace with a non-object
      updated = patch;
    } else {
      // shallow merge patch into existing
      updated = { ...existing, ...patch };
    }
    this.configs.set(id, updated);
    return updated;
  }

  /** Warm the in-memory cache for a shop (accepts full config object) */
  async warmCache(shopId: number, config: any): Promise<void> {
    const id = Number(shopId);
    if (config === null || typeof config === 'undefined') {
      this.configs.delete(id);
    } else {
      this.configs.set(id, config);
    }
  }

  /** Utility to reset the store (helpful in tests) */
  reset(): void {
    this.sessions = [];
    this.events.clear();
    this.configs.clear();
  }

  /** Backwards-compatible helper name used by tests/helpers */
  clearAll(): void {
    // delegate to reset() so behavior stays in one place
    this.reset();
  }
};

// ----------------------------
// Production factory & test override
// ----------------------------

let _overriddenStore: SessionStore | null = null;

/**
 * Create a production store instance based on environment.
 * Supported values: 'memory' (default), 'redis' (if redis package available)
 */
export function createSessionStore(): SessionStore {
  if (_overriddenStore) return _overriddenStore;

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
    } catch (e) {
      // if redis not installed or fails, fallback to memory
      // eslint-disable-next-line no-console
      console.warn('Redis session store unavailable, falling back to InMemorySessionStore:', (e as any)?.message ?? String(e));
    }
  }

  return new InMemorySessionStore();
}

/** Convenience: current singleton store used by ingestion code */
export const sessionStore: SessionStore = createSessionStore();

/** Top-level FT0 helpers (lightweight wrappers around the store) */

/**
 * recordShopSession(shopId, data)
 * Thin wrapper to keep existing saveSession semantics but provide stable FT0 name.
 */
export async function recordShopSession(shopId: number, data: AnonymousSession): Promise<string> {
  const s = { ...data, shopId: Number(shopId) };
  if (!s.sessionId) s.sessionId = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  // delegate to runtime store
  // @ts-ignore
  if (typeof (sessionStore as any).saveSession === 'function') {
    // @ts-ignore
    return await (sessionStore as any).saveSession(s);
  }
  return Promise.resolve(s.sessionId);
}

/** getShopSession(shopId) — return the most recent session or null */
export async function getShopSession(shopId: number): Promise<AnonymousSession | null> {
  const sessions = sessionStore.getAllSessionsForShop(Number(shopId)) || [];
  if (sessions.length === 0) return null;
  return sessions[sessions.length - 1] || null;
}

/** appendEvent(shopId, event) — delegate to store if supported */
export async function appendEvent(shopId: number, event: SpecterEvent): Promise<void> {
  // @ts-ignore
  if (typeof (sessionStore as any).appendEvent === 'function') {
    // @ts-ignore
    return await (sessionStore as any).appendEvent(Number(shopId), event);
  }
  return Promise.resolve();
}

/** getRecentEvents(shopId, limit) — delegate to store if supported */
export async function getRecentEvents(shopId: number, limit = 50): Promise<SpecterEvent[]> {
  // @ts-ignore
  if (typeof (sessionStore as any).getRecentEvents === 'function') {
    // @ts-ignore
    return await (sessionStore as any).getRecentEvents(Number(shopId), limit);
  }
  return [];
}

/** getShopConfig(shopId) — delegate to store if supported */
export async function getShopConfig(shopId: number): Promise<any | null> {
  // @ts-ignore
  if (typeof (sessionStore as any).getShopConfig === 'function') {
    // @ts-ignore
    return await (sessionStore as any).getShopConfig(Number(shopId));
  }
  return null;
}

/** updateShopConfig(shopId, patch) — delegate to store if supported */
export async function updateShopConfig(shopId: number, patch: any): Promise<any | null> {
  // @ts-ignore
  if (typeof (sessionStore as any).updateShopConfig === 'function') {
    // @ts-ignore
    return await (sessionStore as any).updateShopConfig(Number(shopId), patch);
  }
  return null;
}

/** warmCache(shopId, config) — delegate to store if supported */
export async function warmCache(shopId: number, config: any): Promise<void> {
  // @ts-ignore
  if (typeof (sessionStore as any).warmCache === 'function') {
    // @ts-ignore
    return await (sessionStore as any).warmCache(Number(shopId), config);
  }
  return Promise.resolve();
}

/** Test helper: override the runtime store (useful in tests) */
export function setSessionStoreForTests(store: SessionStore | null) {
  _overriddenStore = store;
}

// ---- CommonJS compatibility shim ----
// Some test runners / require() consumers (Jest in CommonJS mode) may load this module via
// `require(...)` and expect a `default` property. Ensure module.exports contains the same members.
/* istanbul ignore next */
declare const module: any;
if (typeof module !== 'undefined' && module.exports) {
  // preserve existing module.exports shape while ensuring default & named props exist
  try {
        module.exports = {
      default: sessionStore,
      InMemorySessionStore,
      // also export interface-friendly named bindings for CJS consumers
      sessionStore,
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
  } catch (e) {
    // defensive: do nothing if environment prevents assignment
  }
}
