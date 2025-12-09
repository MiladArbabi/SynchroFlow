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

/** In-memory session store used for tests and simple dev setups.
 *  Provides saveSession and retrieval helpers expected by ingestion & tests.
 */
export class InMemorySessionStore {
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

// Default singleton instance (used in production-ish dev flows)
const defaultStore = new InMemorySessionStore();
export const sessionStore = defaultStore;


// ---- CommonJS compatibility shim ----
// Some test runners / require() consumers (Jest in CommonJS mode) may load this module via
// `require(...)` and expect a `default` property. Ensure module.exports contains the same members.
/* istanbul ignore next */
declare const module: any;
if (typeof module !== 'undefined' && module.exports) {
  // preserve existing module.exports shape while ensuring default & named props exist
  try {
    module.exports = {
      default: defaultStore,
      InMemorySessionStore,
      // runtime doesn't need types; keep the default instance for require() consumers
      // also keep named methods accessible directly on the exported object
      sessionStore: defaultStore,
      saveSession: defaultStore.saveSession.bind(defaultStore),
      getAllSessionsForShop: defaultStore.getAllSessionsForShop.bind(defaultStore),
      getSessionsLastNDays: defaultStore.getSessionsLastNDays?.bind(defaultStore),
      reset: defaultStore.reset?.bind(defaultStore),
      // expose clearAll alias used by tests
      clearAll: defaultStore.clearAll?.bind(defaultStore)
    };
  } catch (e) {
    // defensive: do nothing if environment prevents assignment
  }
}
