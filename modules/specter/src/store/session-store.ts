import { clearAll } from "./__test-helpers__/session-store-helper";

// modules/specter/src/store/session-store.ts
export interface AnonymousSession {
  sessionId: string;
  shopId: number;
  landingPage?: string;
  pagesViewed?: string[];
  exitIntent: boolean;
  createdAt: string;
  [k: string]: any;
}

/** SessionStore interface (explicit) */
export interface SessionStore {
  saveSession(session: AnonymousSession): Promise<string>;
  getAllSessionsForShop(shopId: number): AnonymousSession[];
  getSessionsLastNDays(shopId: number, days?: number): Promise<AnonymousSession[]>;
  reset(): void;
}

/** In-memory session store used for tests and simple dev setups.
 *  Provides saveSession and retrieval helpers expected by ingestion & tests.
 */
export class InMemorySessionStore implements SessionStore {
  private sessions: AnonymousSession[] = [];

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

  /** Utility to reset the store (helpful in tests) */
  reset(): void {
    this.sessions = [];
  }

  /** Backwards-compatible helper name used by tests/helpers */
  clearAll(): void {
    // delegate to reset() so behavior stays in one place
    this.reset();
  }
}

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
      setSessionStoreForTests
    };
  } catch (e) {
    // defensive: do nothing if environment prevents assignment
  }
}
