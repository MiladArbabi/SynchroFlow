// apps/backend/src/bootstrap/specter-store.ts
// Thin wrapper around the modules/specter session-store so the server bootstrap can call init/close
import { initRedisSessionStore as initImpl, closeRedisSessionStore as closeImpl } from 'modules-specter/store/session-store-redis';

let instance: any = null;

export async function initSpecterStore(): Promise<void> {
  if ((process.env.SPECTER_SESSION_STORE || '').toLowerCase() !== 'redis') return;
  try {
    instance = await initImpl();
    console.log('[bootstrap/specter-store] Specter Redis session store initialized');
  } catch (err) {
    console.warn('[bootstrap/specter-store] Failed to init Specter Redis session store:', err && (err as Error).message ? (err as Error).message : err);
    instance = null;
  }
}

export async function closeSpecterStore(): Promise<void> {
  if (!instance) return;
  try {
    await closeImpl(instance);
    console.log('[bootstrap/specter-store] Specter Redis session store closed');
  } catch (err) {
    console.warn('[bootstrap/specter-store] Error closing specter store:', err && (err as Error).message ? (err as Error).message : err);
  } finally {
    instance = null;
  }
}
