// modules/specter/src/store/session-store-redis.ts
import { createClient, RedisClientType } from 'redis';
import { AnonymousSession, SessionStore } from './session-store.js';
import { randomUUID } from 'crypto';

// Simple logger wrapper so we can later swap to pino easily
const log = {
  info: (...args: any[]) => console.info(...args),
  warn: (...args: any[]) => console.warn(...args),
  error: (...args: any[]) => console.error(...args),
  debug: (...args: any[]) => console.debug(...args)
};

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
export class RedisSessionStore implements SessionStore {
    private client: RedisClientType | null = null;
  private connected = false;

  // Sessions snapshot (synchronous reads)
  private snapshot = new Map<number, AnonymousSession[]>();
  private listMaxLen = Number(process.env.SPECTER_SESSION_STORE_LIST_MAX || 1000);

  // Events snapshot + max length (new)
  private eventsSnapshot = new Map<number, any[]>(); // SpecterEvent[] (avoid import cycle in this file)
  private eventListMaxLen = Number(process.env.SPECTER_EVENT_LIST_MAX || 50);

  private redisUrl = process.env.SPECTER_REDIS_URL || process.env.REDIS_URL || 'redis://localhost:6379';

  constructor(opts?: { redisUrl?: string; listMaxLen?: number }) {
    if (opts?.redisUrl) this.redisUrl = opts.redisUrl;
    if (typeof opts?.listMaxLen === 'number') this.listMaxLen = opts.listMaxLen;
    // do not auto-init here — expose init() to let runtime control startup
  }

  /** Connect the redis client and load an initial snapshot for recent shops (best-effort). */
  async init(): Promise<void> {
    if (this.connected) return;
    try {
      this.client = createClient({ url: this.redisUrl });
      this.client.on('error', (err) => {
        log.error('specter:redis-session-store redis client error', err && err.message ? err.message : err);
      });
      log.info('specter:redis-session-store', 'redis client connecting');
      await this.client.connect();
      this.connected = true;
      log.info('specter:redis-session-store', 'redis connected');

      // Optionally pre-load nothing — keep snapshot empty; we'll populate snapshots lazily on save
      // If you'd rather prefetch keys, implement a list scan here.
    } catch (err: any) {
      log.warn('specter:redis-session-store init failed — leaving disconnected, falling back to memory snapshot:', err && err.message ? err.message : err);
      this.client = null;
      this.connected = false;
    }
  }

  /** Close redis client (used by jest global teardown / runtime shutdown). */
  async close(): Promise<void> {
    if (this.client && this.connected) {
      try {
        await this.client.quit();
        log.info('specter:redis-session-store', 'redis disconnected');
      } catch (e: any) {
        log.warn('specter:redis-session-store close error', e && e.message ? e.message : e);
      }
    }
    this.client = null;
    this.connected = false;
  }

  /** Helper: redis key for shop list */
  private shopKey(shopId: number) {
    return `specter:shop:${shopId}:sessions`;
  }

  /** Helper: redis key for shop event ledger */
  private eventsKey(shopId: number) {
    return `specter:shop:${shopId}:events`;
  }

  /** Helper: redis key for shop config */
  private configKey(shopId: number) {
    return `specter:shop:${shopId}:config`;
  }

  /** Persist a session and return the sessionId */
  async saveSession(session: AnonymousSession): Promise<string> {
    // Ensure sessionId exists (defensive)
    const toSave = { ...session };
    if (!toSave.sessionId) toSave.sessionId = (randomUUID && typeof randomUUID === 'function') ? randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;

    // Update in-memory snapshot synchronously (so tests/readers see it immediately)
    const shop = Number(toSave.shopId || 0);
    const arr = this.snapshot.get(shop) || [];
    // keep a shallow copy (avoid external mutation)
    const copy = { ...toSave, pagesViewed: Array.isArray(toSave.pagesViewed) ? toSave.pagesViewed.slice() : [] };
    arr.push(copy);
    this.snapshot.set(shop, arr);

    // If redis connected, push to list and trim
    if (this.client && this.connected) {
      try {
        const key = this.shopKey(shop);
        // LPUSH newest at head; keep list length bounded
        await this.client.lPush(key, JSON.stringify(copy));
        if (this.listMaxLen > 0) {
          await this.client.lTrim(key, 0, this.listMaxLen - 1);
        }
      } catch (e: any) {
        log.warn('specter:redis-session-store saveSession: redis write failed, retaining in-memory snapshot', e && e.message ? e.message : e);
      }
    } else {
      log.debug('specter:redis-session-store saveSession called while redis not connected — falling back to memory-only snapshot');
    }

    return copy.sessionId;
  }

  /** Synchronous accessor used by computeSessionMetrics in tests */
  getAllSessionsForShop(shopId: number): AnonymousSession[] {
    const shop = Number(shopId);
    const arr = this.snapshot.get(shop);
    // Return a copy to avoid external mutation
    return Array.isArray(arr) ? arr.slice() : [];
  }

  /** Async helper used by some tests: return sessions from last N days (by createdAt) */
  async getSessionsLastNDays(shopId: number, days = 7): Promise<AnonymousSession[]> {
    const shop = Number(shopId);

    // If redis connected, prefer authoritative source by reading list
    if (this.client && this.connected) {
      try {
        const key = this.shopKey(shop);
        // lRange returns newest first (we used LPUSH)
        const items = await this.client.lRange(key, 0, -1);
        const parsed: AnonymousSession[] = items.map(i => {
          try { return JSON.parse(i); } catch { return null; }
        }).filter(Boolean) as AnonymousSession[];

        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        return parsed.filter(s => {
          const t = Date.parse(s?.createdAt || '');
          return !Number.isNaN(t) && t >= cutoff;
        });
      } catch (e: any) {
        log.warn('specter:redis-session-store getSessionsLastNDays: redis read failed — falling back to snapshot', e && e.message ? e.message : e);
      }
    }

    // Fallback: use in-memory snapshot
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return this.getAllSessionsForShop(shop).filter(s => {
      const t = Date.parse(s.createdAt || '');
      return !Number.isNaN(t) && t >= cutoff;
    });
  }

  /* ------------------------
   * Event ledger (redis-backed)
   * ------------------------ */

  /** Append an event to the shop's event list (newest-first via LPUSH). */
  async appendEvent(shopId: number, event: any): Promise<void> {
    const id = Number(shopId);
    const ev = { timestamp: event.timestamp || Date.now(), ...event };

    // Maintain in-memory snapshot for synchronous reads
    const arr = this.eventsSnapshot.get(id) || [];
    arr.unshift(ev);
    if (this.eventListMaxLen > 0 && arr.length > this.eventListMaxLen) {
      arr.length = this.eventListMaxLen;
    }
    this.eventsSnapshot.set(id, arr);

    // If redis connected, LPUSH + LTRIM
    if (this.client && this.connected) {
      try {
        const key = this.eventsKey(id);
        await this.client.lPush(key, JSON.stringify(ev));
        if (this.eventListMaxLen > 0) {
          await this.client.lTrim(key, 0, this.eventListMaxLen - 1);
        }
      } catch (e: any) {
        log.warn('specter:redis-session-store appendEvent: redis write failed, retaining in-memory snapshot', e && e.message ? e.message : e);
      }
    } else {
      log.debug('specter:redis-session-store appendEvent called while redis not connected — using in-memory snapshot only');
    }
  }

  /** Read recent events (newest-first) from Redis or fallback to snapshot. */
  async getRecentEvents(shopId: number, limit = 50): Promise<any[]> {
    const id = Number(shopId);

    if (this.client && this.connected) {
      try {
        const key = this.eventsKey(id);
        const items = await this.client.lRange(key, 0, Math.max(limit - 1, 0));
        const parsed = items.map(i => {
          try { return JSON.parse(i); } catch { return null; }
        }).filter(Boolean);
        return parsed.slice(0, limit);
      } catch (e: any) {
        log.warn('specter:redis-session-store getRecentEvents: redis read failed — falling back to snapshot', e && e.message ? e.message : e);
      }
    }

    const arr = this.eventsSnapshot.get(id) || [];
    return arr.slice(0, limit);
  }

   /* ------------------------
   * Config (redis-backed)
   * ------------------------ */

  /** Read shop config (returns parsed JSON or null) */
  async getShopConfig(shopId: number): Promise<any | null> {
    const id = Number(shopId);
    // Prefer authoritative Redis value if connected
    if (this.client && this.connected) {
      try {
        const key = this.configKey(id);
        const raw = await (this.client as any).get(key);
        if (!raw) return null;
        try { return JSON.parse(raw); } catch { return raw; }
      } catch (e: any) {
        log.warn('specter:redis-session-store getShopConfig: redis read failed — falling back to snapshot', e && e.message ? e.message : e);
      }
    }

    // Fallback: in-memory snapshot (if warmed)
    const cfg = (this as any).configsSnapshot ? (this as any).configsSnapshot.get(id) : undefined;
    return cfg || null;
  }

  /** Update/replace shop config in Redis and warm snapshot */
  async updateShopConfig(shopId: number, patch: any): Promise<any> {
    const id = Number(shopId);
    const newVal = patch;
    // Store in Redis if possible
    if (this.client && this.connected) {
      try {
        const key = this.configKey(id);
        // store as JSON string
        await (this.client as any).set(key, typeof newVal === 'string' ? newVal : JSON.stringify(newVal));
      } catch (e: any) {
        log.warn('specter:redis-session-store updateShopConfig: redis write failed — retaining in-memory snapshot', e && e.message ? e.message : e);
      }
    }

    // Warm in-memory snapshot
    // keep a simple separate map on the instance for configs
    if (!((this as any).configsSnapshot)) (this as any).configsSnapshot = new Map<number, any>();
    (this as any).configsSnapshot.set(id, newVal);

    return newVal;
  }

  /** Warm the in-memory cache for a shop (accepts full config object) */
  async warmCache(shopId: number, config: any): Promise<void> {
    const id = Number(shopId);
    if (!((this as any).configsSnapshot)) (this as any).configsSnapshot = new Map<number, any>();
    if (config === null || typeof config === 'undefined') {
      (this as any).configsSnapshot.delete(id);
      // Also remove from redis if connected
      if (this.client && this.connected) {
        try {
          const key = this.configKey(id);
          await (this.client as any).del(key);
        } catch (e: any) {
          log.warn('specter:redis-session-store warmCache: redis delete failed', e && e.message ? e.message : e);
        }
      }
    } else {
      (this as any).configsSnapshot.set(id, config);
      // Persist to redis if connected
      if (this.client && this.connected) {
        try {
          const key = this.configKey(id);
          await (this.client as any).set(key, typeof config === 'string' ? config : JSON.stringify(config));
        } catch (e: any) {
          log.warn('specter:redis-session-store warmCache: redis write failed', e && e.message ? e.message : e);
        }
      }
    }
  }


  /** Utility to reset the store (helpful in tests)
   *
   * Notes:
   * - This starts a non-blocking, best-effort cleanup job and returns immediately.
   * - Deletion is done in small batches to avoid argument-count limits.
   * - Tries UNLINK, falls back to DEL, falls back to sending raw commands, and finally deletes one-by-one.
   */
    async reset(): Promise<void> {
    // synchronous snapshot clears
    try { this.snapshot.clear(); } catch (_) {}
    try { this.eventsSnapshot.clear(); } catch (_) {}
    if ((this as any).configsSnapshot) {
      try { (this as any).configsSnapshot.clear(); } catch (_) {}
    }

    if (!this.client || !this.connected) {
      log.debug('specter:redis-session-store reset: no redis client or not connected, skipped redis cleanup');
      return;
    }

    (async () => {
      const client: any = this.client;
      const patterns = [
        'specter:shop:*:sessions',
        'specter:shop:*:events',
        'specter:shop:*:config'
      ];

      const collected = new Set<string>();
      try {
        // collect keys
        for (const pattern of patterns) {
          try {
            if (typeof client.scanIterator === 'function') {
              for await (const k of client.scanIterator({ MATCH: pattern, COUNT: 1000 })) {
                if (typeof k === 'string' && k) collected.add(k);
              }
            } else if (typeof client.scan === 'function') {
              let cursor = '0';
              do {
                const res = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 1000);
                if (!res) break;
                if (Array.isArray(res) && res.length >= 2) {
                  cursor = String(res[0]);
                  const keys = Array.isArray(res[1]) ? res[1] : [];
                  for (const k of keys) if (typeof k === 'string' && k) collected.add(k);
                } else break;
              } while (cursor !== '0');
            } else {
              log.debug('specter:redis-session-store reset: client has no scan/scanIterator, skipping', pattern);
            }
          } catch (scanErr: any) {
            log.warn('specter:redis-session-store reset: scan failed for pattern', pattern, scanErr && scanErr.stack ? scanErr.stack : scanErr);
          }
        }

        const allKeys = Array.from(collected).filter(Boolean);
        if (allKeys.length === 0) {
          log.debug('specter:redis-session-store reset: no redis keys found to remove');
          return;
        }

        const CHUNK_SIZE = 200;
        let totalRemoved = 0;

        for (let i = 0; i < allKeys.length; i += CHUNK_SIZE) {
          const chunk = allKeys.slice(i, i + CHUNK_SIZE);
          const safeChunk = chunk.map(k => (typeof k === 'string' ? k : String(k))).filter(Boolean);
          if (safeChunk.length === 0) continue;

          // log pre-delete diagnostic (cap sample keys to avoid huge logs)
          const sample = safeChunk.slice(0, 6);
          log.debug('specter:redis-session-store reset: attempting chunk delete', { chunkIdx: (i / CHUNK_SIZE), chunkLen: safeChunk.length, sample });

          let chunkDeleted = false;
          // helper to mark and log errors
          const handleDeleteError = (method: string, err: any) => {
            const msg = err && err.message ? err.message : String(err);
            log.warn('specter:redis-session-store reset: chunk delete failed', { method, chunkLen: safeChunk.length, error: msg, stack: err && err.stack ? err.stack : undefined });
          };

          // Try UNLINK -> DEL -> sendCommand
          try {
            if (typeof client.unlink === 'function') {
              try {
                await client.unlink(...safeChunk);
              } catch (e1) {
                // some clients insist on array argument
                try { await client.unlink(safeChunk); } catch (e2) { throw e1; }
              }
              log.debug('specter:redis-session-store reset: chunk removed via UNLINK', { chunkLen: safeChunk.length });
              chunkDeleted = true;
            } else if (typeof client.del === 'function') {
              try {
                await client.del(...safeChunk);
              } catch (e1) {
                try { await client.del(safeChunk); } catch (e2) { throw e1; }
              }
              log.debug('specter:redis-session-store reset: chunk removed via DEL', { chunkLen: safeChunk.length });
              chunkDeleted = true;
            } else if (typeof client.sendCommand === 'function') {
              // low-level raw send
              try {
                await client.sendCommand(['UNLINK', ...safeChunk]);
                log.debug('specter:redis-session-store reset: chunk removed via sendCommand UNLINK', { chunkLen: safeChunk.length });
                chunkDeleted = true;
              } catch (eCmd) {
                try {
                  await client.sendCommand(['DEL', ...safeChunk]);
                  log.debug('specter:redis-session-store reset: chunk removed via sendCommand DEL', { chunkLen: safeChunk.length });
                  chunkDeleted = true;
                } catch (eCmd2) {
                  throw eCmd2;
                }
              }
            }
          } catch (chunkErr: any) {
            handleDeleteError('bulk-delete', chunkErr);
            // If the error text matches the specific 'wrong number of arguments' server error,
            // we will immediately fall back to per-key deletion for this chunk.
            const errMsg = chunkErr && chunkErr.message ? chunkErr.message : '';
            if (errMsg.includes('wrong number of arguments')) {
              log.warn('specter:redis-session-store reset: detected wrong number of args error -> falling back to per-key deletion for this chunk', { sample });
            } else {
              log.warn('specter:redis-session-store reset: bulk delete failed, falling back to per-key deletion', { sample });
            }
          }

          if (chunkDeleted) {
            totalRemoved += safeChunk.length;
            continue;
          }

          // per-key deletion fallback (isolates malformed keys)
          for (const key of safeChunk) {
            try {
              if (typeof client.unlink === 'function') {
                try { await client.unlink(key); } catch (_) { await client.del(key); }
              } else if (typeof client.del === 'function') {
                try { await client.del(key); } catch (_) {
                  if (typeof client.sendCommand === 'function') await client.sendCommand(['DEL', key]);
                }
              } else if (typeof client.sendCommand === 'function') {
                await client.sendCommand(['DEL', key]);
              } else {
                log.warn('specter:redis-session-store reset: no deletion method found for key', key);
              }
              totalRemoved++;
            } catch (perKeyErr: any) {
              const perMsg = perKeyErr && perKeyErr.message ? perKeyErr.message : String(perKeyErr);
              log.warn('specter:redis-session-store reset: failed to delete key', { key, error: perMsg, stack: perKeyErr && perKeyErr.stack ? perKeyErr.stack : undefined });
            }
          }
        } // end chunk loop

        log.info('specter:redis-session-store reset: finished redis cleanup', { requested: allKeys.length, removed: totalRemoved });
      } catch (outerErr: any) {
        log.warn('specter:redis-session-store reset: unexpected error in cleanup job', outerErr && outerErr.stack ? outerErr.stack : outerErr);
      }
    })().catch(e => {
      log.warn('specter:redis-session-store reset: cleanup job crashed', e && e.stack ? e.stack : e);
    });

    return;
  }
}

/** Export convenience init/close functions (runtime lifecycle hooks) */
export async function initRedisSessionStore(store?: RedisSessionStore) {
  const s = store || new RedisSessionStore();
  await s.init();
  return s;
}

export async function closeRedisSessionStore(store: RedisSessionStore) {
  if (store) await store.close();
}
