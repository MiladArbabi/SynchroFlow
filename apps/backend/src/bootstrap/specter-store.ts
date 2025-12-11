// apps/backend/src/bootstrap/specter-store.ts
// Thin wrapper around the modules/specter redis session-store so the server bootstrap can call init/close
// Enhanced behaviour:
// - Start Redis store if SPECTER_SESSION_STORE=redis OR if a Redis URL is provided via env.
// - Keep idempotent init/close and robust logging.
import { initRedisSessionStore as initImpl, closeRedisSessionStore as closeImpl } from 'modules-specter/store/session-store-redis';

let instance: any = null;

/** Decide whether we should attempt to initialize the redis-backed store. */
function shouldInitRedis(): boolean {
  const explicit = (process.env.SPECTER_SESSION_STORE || '').toLowerCase() === 'redis';
  const hasUrl = Boolean(process.env.SPECTER_REDIS_URL || process.env.REDIS_URL);
  return explicit || hasUrl;
}

export async function initSpecterStore(): Promise<void> {
  if (!shouldInitRedis()) {
    console.debug('[bootstrap/specter-store] Redis not requested (SPECTER_SESSION_STORE!=redis and no REDIS_URL). Skipping init.');
    return;
  }

  if (instance) {
    console.debug('[bootstrap/specter-store] Specter store already initialized — skipping.');
    return;
  }

  try {
    instance = await initImpl();
    console.log('[bootstrap/specter-store] Specter Redis session store initialized');
  } catch (err) {
    console.warn('[bootstrap/specter-store] Failed to init Specter Redis session store:', err && (err as Error).message ? (err as Error).message : err);
    instance = null;
  }
}

export async function closeSpecterStore(): Promise<void> {
  if (!instance) {
    console.debug('[bootstrap/specter-store] No specter store instance to close.');
    return;
  }
  try {
    await closeImpl(instance);
    console.log('[bootstrap/specter-store] Specter Redis session store closed');
  } catch (err) {
    console.warn('[bootstrap/specter-store] Error closing specter store:', err && (err as Error).message ? (err as Error).message : err);
  } finally {
    instance = null;
  }
}
